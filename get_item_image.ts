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
    source_url: { type: "string" },
    found_method: { type: "string", description: "How the image was found (og:image, product__media, first_img)" },
  },
  required: ["image_url", "source_url", "found_method"],
  additionalProperties: false,
};

// Extract image URL with structured output
async function extractImageUrl(productUrl: string) {
  const response = await axios.get(productUrl);
  const $ = cheerio.load(response.data);
  const strategies: [cheerio.Cheerio<any>, string, string][] = [
    [$("meta[property='og:image']"), "content", "og:image"],
    [$("img.product__media"), "src", "product__media"],
    [$("img").first(), "src", "first_img"],
  ];
  for (const [tag, attr, method] of strategies) {
    const val = tag.attr(attr);
    if (val) {
      return {
        image_url: val,
        source_url: productUrl,
        found_method: method,
      };
    }
  }
  return {
    image_url: null,
    source_url: productUrl,
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
  const inputMessages: any[] = [
    { role: "user", content: "Get the image for https://minecraftshop.com/collections/plush/products/minecraft-goat-8-plush" },
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
}

main();
