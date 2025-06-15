import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import axios from "axios";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: process.env.AZURE_OPENAI_V1_API_ENDPOINT,
  defaultQuery: { "api-version": "preview" },
});

export const partDetailsPrompt = (url: string, pageContent: string): string => {
  return `
    You are an expert automotive parts specialist. Analyze the following product page content from ${url} and extract the automotive part information.

    Page Content:
    ${pageContent}

    Extract the following information:
    - manufacturer: The exact brand or company name that makes this part
    - partName: The specific name/title of this automotive part
    - partNumber: The manufacturer's exact part number/SKU. Look for:
      * Text preceded by "Part #", "Part Number", "SKU", "Model", "MPN", "Item #"
      * Alphanumeric codes like ABC123, 12345-678, A1B2C3, etc.
      * ASIN numbers for Amazon products
      * Any product identifiers in the content
      * If no part number is found anywhere, leave as empty string ""
      * NEVER use placeholder text like "Not specified", "N/A", "Unknown"
    - category: Select the most accurate category number from the list below

    IMPORTANT: Scan ALL the content carefully for part numbers. They may appear in product details, specifications, tables, or anywhere in the text. Be thorough in your search.

    Category options:
    1 = airDeliverySystems (intake, air filters, throttle bodies)
    2 = brakeSystems (brake pads, rotors, calipers, brake lines)
    3 = cooling (radiators, fans, coolant hoses, thermostats)
    4 = drivetrain (transmissions, differentials, axles, driveshafts)
    5 = electricalSystems (wiring, relays, fuses, switches)
    6 = electronics (ECUs, sensors, modules, gauges)
    7 = engine (pistons, valves, gaskets, timing components)
    8 = exhaustSystems (headers, catalytic converters, mufflers, pipes)
    9 = exteriorAccessories (body kits, spoilers, trim, mirrors)
    10 = fabrication (welding supplies, hardware, brackets)
    11 = fluids (oil, coolant, brake fluid, additives)
    12 = forcedInduction (turbochargers, superchargers, intercoolers)
    13 = fuelDeliverySystems (fuel pumps, injectors, filters, rails)
    14 = ignition (spark plugs, coils, distributors, wires)
    15 = interiorAccessories (seats, steering wheels, shift knobs)
    16 = lighting (headlights, taillights, LED strips, bulbs)
    17 = safety (roll cages, harnesses, fire extinguishers)
    18 = suspension (shocks, springs, sway bars, bushings)
    19 = swag (apparel, stickers, keychains, merchandise)
    20 = wheelsAndTires (wheels, tires, lug nuts, valve stems)
    21 = audio (speakers, amplifiers, head units, subwoofers)
  `;
};

// Function to clean HTML and extract relevant content for LLM analysis using markdown
function extractCleanPageContent($: cheerio.CheerioAPI, finalUrl: string): string {
  // Remove unwanted elements
  $('script, style, nav, footer, header, aside, .cookie, .banner, .popup, .advertisement').remove();
  $('[class*="ad"], [class*="cookie"], [class*="banner"], [class*="popup"], [class*="nav"], [class*="footer"]').remove();
  
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });
  
  // Configure turndown to preserve important attributes and structure
  turndownService.addRule('preserveProductInfo', {
    filter: function(node) {
      return node.nodeName === 'SPAN' || node.nodeName === 'DIV' || node.nodeName === 'TD' || node.nodeName === 'TH';
    },
    replacement: function(content) {
      return content;
    }
  });

  const sections: string[] = [];
  
  // Page title
  const title = $('title').text().trim();
  if (title) sections.push(`# Page Title\n${title}\n`);
  
  // Meta description
  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  if (metaDesc) sections.push(`## Description\n${metaDesc}\n`);
  
  // Extract Amazon-specific structured data first
  if (finalUrl.includes('amazon.')) {
    sections.push(`## Amazon Product Information`);
    
    // Product title
    const productTitle = $('#productTitle').text().trim();
    if (productTitle) sections.push(`**Product Title:** ${productTitle}\n`);
    
    // Brand info
    const brandInfo = $('#bylineInfo').text().trim();
    if (brandInfo) sections.push(`**Brand:** ${brandInfo}\n`);
    
    // ASIN
    const asin = $('input[name="ASIN"]').val() || $('[data-asin]').attr('data-asin');
    if (asin) sections.push(`**ASIN:** ${asin}\n`);
    
    // Product details table
    const productDetails = $('#detailBullets_feature_div, #productDetails_techSpec_section_1');
    if (productDetails.length) {
      sections.push(`### Product Details`);
      productDetails.find('tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length >= 2) {
          const label = $(cells[0]).text().trim().replace(/\s+/g, ' ');
          const value = $(cells[1]).text().trim().replace(/\s+/g, ' ');
          if (label && value && label.length < 100 && value.length < 200) {
            sections.push(`- **${label}:** ${value}`);
          }
        }
      });
      sections.push('');
    }
    
    // Feature bullets
    const featureBullets = $('#feature-bullets ul li, .a-unordered-list .a-list-item');
    if (featureBullets.length) {
      sections.push(`### Key Features`);
      featureBullets.each((_, item) => {
        const text = $(item).text().trim().replace(/\s+/g, ' ');
        if (text && text.length > 10 && text.length < 300) {
          sections.push(`- ${text}`);
        }
      });
      sections.push('');
    }
  }
  
  // Extract main product content area
  const mainContent = $('main, .main, #main, .content, .product, .item-details, .product-details');
  if (mainContent.length) {
    sections.push(`## Main Product Content`);
    
    // Convert main content to markdown
    const mainHtml = mainContent.first().html() || '';
    if (mainHtml) {
      try {
        const markdown = turndownService.turndown(mainHtml);
        // Clean up the markdown and limit length
        const cleanMarkdown = markdown
          .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
          .replace(/\[.*?\]\(.*?\)/g, '') // Remove links
          .substring(0, 3000); // Limit length
        sections.push(cleanMarkdown);
      } catch (e) {
        // Fallback to text extraction if markdown conversion fails
        const text = mainContent.text().trim().replace(/\s+/g, ' ').substring(0, 1500);
        sections.push(text);
      }
    }
  }
  
  // Extract specification tables specifically
  $('table').each((_, table) => {
    const $table = $(table);
    const tableText = $table.text().toLowerCase();
    
    // Only process tables that likely contain specifications
    if (tableText.includes('specification') || 
        tableText.includes('details') || 
        tableText.includes('part') || 
        tableText.includes('model') || 
        tableText.includes('sku')) {
      
      sections.push(`### Product Specifications Table`);
      
      $table.find('tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length >= 2) {
          const label = $(cells[0]).text().trim().replace(/\s+/g, ' ');
          const value = $(cells[1]).text().trim().replace(/\s+/g, ' ');
          if (label && value && label.length < 100 && value.length < 200) {
            sections.push(`- **${label}:** ${value}`);
          }
        }
      });
      sections.push('');
    }
  });
  
  // Look for specific part number indicators
  sections.push(`### Part Number Analysis`);
  
  // Common part number selectors
  const partSelectors = [
    '.sku', '.part-number', '.model-number', '.product-code', '.item-model', '.mpn',
    '[data-sku]', '[data-part]', '[data-model]'
  ];
  
  partSelectors.forEach(selector => {
    $(selector).each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 2 && text.length < 50) {
        sections.push(`- Found in ${selector}: ${text}`);
      }
    });
  });
  
  // Search for part numbers in text using patterns
  const partNumberPatterns = [
    /(?:part\s*#|part\s*number|sku|model|mpn|item\s*#|part\s*no\.?)[\s:]*([A-Z0-9\-_\.]{3,})/gi,
    /(?:model|part)[\s:]*([A-Z]{1,3}[\d\-_\.]{3,}[A-Z0-9]*)/gi,
    /\b([A-Z]{2,4}\d{3,}[A-Z0-9\-_\.]*)\b/g
  ];
  
  const allText = $.text();
  partNumberPatterns.forEach((pattern, index) => {
    const matches = allText.match(pattern);
    if (matches) {
      matches.slice(0, 5).forEach(match => { // Limit to 5 matches per pattern
        sections.push(`- Pattern ${index + 1} match: ${match.trim()}`);
      });
    }
  });
  
  // Clean up and join sections
  const content = sections.join('\n').replace(/\n{3,}/g, '\n\n');
  
  // Debug output if enabled
  if (process.env.DEBUG_CONTENT) {
    console.log('\n=== EXTRACTED MARKDOWN CONTENT ===');
    console.log(content.substring(0, 1000) + '...');
    console.log('=== END EXTRACTED CONTENT ===\n');
  }
  
  return content;
}


// Extract image URL from pre-loaded Cheerio content
function extractImageFromContent($: cheerio.CheerioAPI, originalUrl: string, finalUrl: string): string | null {
  // Amazon-specific extraction
  if (finalUrl.includes('amazon.') || originalUrl.includes('a.co/')) {
    // Try to get the main image from the dynamic image data attribute
    const imgTag = $('#imgTagWrapperId img');
    const dataImage = imgTag.attr('data-a-dynamic-image');
    if (dataImage) {
      try {
        const images = JSON.parse(dataImage);
        const firstImage = Object.keys(images)[0];
        if (firstImage) {
          return firstImage.startsWith('http') ? firstImage : `https:${firstImage}`;
        }
      } catch (e) {
        // fallback to next strategies
      }
    }
    // Fallback: look for og:image
    const ogImage = $("meta[property='og:image']").attr('content');
    if (ogImage) {
      return ogImage;
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
        return src;
      }
    }
  }
  
  // Generic strategies
  const strategies: [cheerio.Cheerio<any>, string][] = [
    [$("meta[property='og:image']"), "content"],
    [$("img.product__media"), "src"],
    [$("img").first(), "src"],
  ];
  for (const [tag, attr] of strategies) {
    let val = tag.attr(attr);
    if (val && val.startsWith('//')) val = 'https:' + val;
    if (val) {
      return val;
    }
  }
  return null;
}

// Schema for LLM extraction (without stockImage since it's handled separately)
const llmPartDetailsSchema = {
  type: "object",
  properties: {
    manufacturer: { type: "string", description: "The brand or company that manufactures this automotive part" },
    partName: { type: "string", description: "The name or title of the automotive part" },
    partNumber: { type: "string", description: "The manufacturer's specific part number or SKU" },
    category: { type: "integer", minimum: 1, maximum: 21, description: "Numerical category ID (1-21) representing the type of automotive part" },
  },
  required: ["manufacturer", "partName", "partNumber", "category"],
  additionalProperties: false,
};

// Complete workflow function that handles URL fetching, content extraction, and part details extraction
async function extractPartDetailsFromUrl(partUrl: string) {
  // Handle redirects
  let finalUrl = partUrl;
  try {
    const redirectResponse = await axios.get(partUrl, { maxRedirects: 5 });
    finalUrl = redirectResponse.request.res.responseUrl || partUrl;
  } catch (e) {
    // If redirect fails, continue with original URL
  }

  const response = await axios.get(finalUrl);
  const $ = cheerio.load(response.data);

  // Extract the main product image URL using the modular function
  const stockImage = extractImageFromContent($, partUrl, finalUrl);

  // Extract clean, structured page content for LLM analysis
  const cleanPageContent = extractCleanPageContent($, finalUrl);

  // Now call the refactored extractPartDetails with the content and stock image
  const partDetails = await useChatGpt(cleanPageContent, finalUrl, stockImage || "");
  
  // return partDetails;
  // Add the stock image that was extracted separately
  return {
    ...partDetails,
    stockImage: stockImage
  };
}

// Extract part details with structured output from pre-scraped content
async function useChatGpt(pageContent: string, sourceUrl: string = '', stockImage: string = '') {
  // Use the LLM to analyze the content and extract structured part details
  const prompt = partDetailsPrompt(sourceUrl, pageContent);
  
  const response = await client.responses.create({
    model: process.env.AZURE_OPENAI_API_MODEL!,
    input: [{ role: "user", content: prompt }],
    text: {
      format: {
        type: "json_schema",
        name: "part_details_extraction",
        schema: llmPartDetailsSchema,
        strict: true,
      },
    },
    temperature: 0.0,
  });

  const partDetails = JSON.parse(response.output_text);

  return partDetails;
}

const tools: any[] = [
  {
    type: "function",
    name: "extract_part_details",
    description: "Extract automotive part details from pre-scraped page content.",
    parameters: {
      type: "object",
      properties: {
        page_content: { type: "string", description: "Pre-scraped and cleaned page content" },
        source_url: { type: "string", description: "The original URL where the content came from" },
      },
      required: ["page_content"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx ts-node get_part_details.ts <part_url>');
    process.exit(1);
  }

  // Use the complete workflow function
  const result = await extractPartDetailsFromUrl(url);
  console.log(result);
  process.exit(0);
}

main();
