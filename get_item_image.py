import requests
import json
import os
from openai import OpenAI
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    base_url=os.getenv("AZURE_OPENAI_V1_API_ENDPOINT"),
    default_query={"api-version": "preview"}, 
)

# Add a structured response schema for the image extraction
image_schema = {
    "type": "object",
    "properties": {
        "image_url": {"type": "string"},
        "source_url": {"type": "string"},
        "found_method": {"type": "string", "description": "How the image was found (og:image, product__media, first_img)"}
    },
    "required": ["image_url", "source_url", "found_method"],
    "additionalProperties": False
}

# Update extract_image_url to return structured output
def extract_image_url(product_url):
    response = requests.get(product_url)
    soup = BeautifulSoup(response.text, 'html.parser')
    # Try all strategies in order
    strategies = [
        (soup.find('meta', property='og:image'), 'content', 'og:image'),
        (soup.find('img', {'class': 'product__media'}), 'src', 'product__media'),
        (soup.find('img'), 'src', 'first_img'),
    ]
    for tag, attr, method in strategies:
        if tag and tag.get(attr):
            return {
                "image_url": tag[attr],
                "source_url": product_url,
                "found_method": method
            }
    return {
        "image_url": None,
        "source_url": product_url,
        "found_method": "not_found"
    }

tools = [{
    "type": "function",
    "name": "extract_image_url",
    "description": "Extract the main image URL from an e-commerce product page URL.",
    "parameters": {
        "type": "object",
        "properties": {
            "product_url": {"type": "string"}
        },
        "required": ["product_url"],
        "additionalProperties": False
    },
    "strict": True
}]

input_messages = [{"role": "user", "content": "Get the image for https://minecraftshop.com/collections/plush/products/minecraft-goat-8-plush"}]

response = client.responses.create(
    model=os.environ["AZURE_OPENAI_API_MODEL"],
    input=input_messages,
    tools=tools,
    temperature=0.0,
    
)

tool_call = response.output[0]
args = json.loads(tool_call.arguments)

# When calling extract_image_url, return the structured response as JSON
result = extract_image_url(args["product_url"])

input_messages.append(tool_call)  # append model's function call message
input_messages.append({                               # append result message
    "type": "function_call_output",
    "call_id": tool_call.call_id,
    "output": json.dumps(result)
})

response_2 = client.responses.create(
    model=os.environ["AZURE_OPENAI_API_MODEL"],
    input=input_messages,
    tools=tools,
    text={
        "format": {
            "type": "json_schema",
            "name": "image_extraction_result",
            "schema": image_schema,
            "strict": True
        }
    }
)

result = json.loads(response_2.output_text)

print(result)