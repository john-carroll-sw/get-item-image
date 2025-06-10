import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import axios from "axios";
import * as cheerio from "cheerio";

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: process.env.AZURE_OPENAI_V1_API_ENDPOINT,
  defaultQuery: { "api-version": "preview" },
});

// Structured response schema for image extraction
const imageSchema = {
  type: "object",
  properties: {
    image_url: { type: "string" },
    original_url: { type: "string", description: "The original URL that was provided as input" },
    source_url: { type: "string", description: "The final URL that was used to extract the image (after redirects)" },
    found_method: { type: "string", description: "How the image was found (og:image, product__media, first_img)" },
  },
  required: ["image_url", "original_url", "source_url", "found_method"],
  additionalProperties: false,
};

// Extract image URL with structured output
async function extractImageUrl(productUrl: string) {
  // Handle Amazon short URLs (a.co) by following redirects
  let finalUrl = productUrl;
  if (productUrl.includes('a.co/')) {
    try {
      const redirectResponse = await axios.get(productUrl, { maxRedirects: 5 });
      finalUrl = redirectResponse.request.res.responseUrl || productUrl;
    } catch (e) {
      // If redirect fails, continue with original URL
    }
  }

  const response = await axios.get(finalUrl);
  const $ = cheerio.load(response.data);

  // Amazon-specific extraction
  if (finalUrl.includes('amazon.') || productUrl.includes('a.co/')) {
    // Try to get the main image from the dynamic image data attribute
    const imgTag = $('#imgTagWrapperId img');
    const dataImage = imgTag.attr('data-a-dynamic-image');
    if (dataImage) {
      try {
        const images = JSON.parse(dataImage);
        const firstImage = Object.keys(images)[0];
        if (firstImage) {
          return {
            image_url: firstImage.startsWith('http') ? firstImage : `https:${firstImage}`,
            original_url: productUrl,
            source_url: finalUrl,
            found_method: 'amazon:data-a-dynamic-image',
          };
        }
      } catch (e) {
        // fallback to next strategies
      }
    }
    // Fallback: look for og:image
    const ogImage = $("meta[property='og:image']").attr('content');
    if (ogImage) {
      return {
        image_url: ogImage,
        original_url: productUrl,
        source_url: finalUrl,
        found_method: 'og:image',
      };
    }
    // Fallback: look for first large image in the page
    const largeImg = $("img[src]").filter((_, el) => {
      const src = $(el).attr('src');
      return !!src && src.includes('images') && src.endsWith('.jpg');
    }).first();
    if (largeImg.length) {
      let src = largeImg.attr('src');
      if (src && src.startsWith('//')) src = 'https:' + src;
      if (src) {
        return {
          image_url: src,
          original_url: productUrl,
          source_url: finalUrl,
          found_method: 'amazon:img[src]',
        };
      }
    }
  }

  // Generic strategies
  const strategies: [cheerio.Cheerio<any>, string, string][] = [
    [$("meta[property='og:image']"), "content", "og:image"],
    [$("img.product__media"), "src", "product__media"],
    [$("img").first(), "src", "first_img"],
  ];
  for (const [tag, attr, method] of strategies) {
    let val = tag.attr(attr);
    if (val && val.startsWith('//')) val = 'https:' + val;
    if (val) {
      return {
        image_url: val,
        original_url: productUrl,
        source_url: finalUrl,
        found_method: method,
      };
    }
  }
  return {
    image_url: null,
    original_url: productUrl,
    source_url: finalUrl,
    found_method: "not_found",
  };
}

const tools: any[] = [
  {
    type: "function",
    name: "extract_image_url",
    description: "Extract the main image URL from an e-commerce product page URL.",
    parameters: {
      type: "object",
      properties: {
        product_url: { type: "string" },
      },
      required: ["product_url"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx ts-node get_item_image.ts <product_url>');
    process.exit(1);
  }
  const inputMessages: any[] = [
    { role: "user", content: `Get the image for ${url}` },
  ];

  const response = await client.responses.create({
    model: process.env.AZURE_OPENAI_API_MODEL!,
    input: inputMessages,
    tools,
    temperature: 0.0,
  });

  const toolCall = response.output[0] as any;
  const args = JSON.parse(toolCall.arguments);

  // When calling extractImageUrl, return the structured response as JSON
  const result = await extractImageUrl(args["product_url"]);

  inputMessages.push(toolCall);
  inputMessages.push({
    type: "function_call_output",
    call_id: toolCall.call_id,
    output: JSON.stringify(result),
  });

  const response2 = await client.responses.create({
    model: process.env.AZURE_OPENAI_API_MODEL!,
    input: inputMessages,
    tools,
    text: {
      format: {
        type: "json_schema",
        name: "image_extraction_result",
        schema: imageSchema,
        strict: true,
      },
    },
  });

  const finalResult = JSON.parse(response2.output_text);
  console.log(finalResult);
  process.exit(0);
}

main();
