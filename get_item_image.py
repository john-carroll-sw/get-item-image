import requests
import json
import os
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from bs4 import BeautifulSoup
from dotenv import load_dotenv


# Load environment variables from .env file
load_dotenv()

# Get endpoint from environment variable
endpoint = os.getenv("ENDPOINT")
if not endpoint:
    raise ValueError("ENDPOINT environment variable is not set in .env file")

model_name = "gpt-4.1"
deployment = "gpt-4.1"
token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")
api_version = "2025-04-01-preview"

client = AzureOpenAI(
    api_version=api_version,
    azure_endpoint=endpoint,
    azure_ad_token_provider=token_provider,
)

def extract_image_url(product_url):
    response = requests.get(product_url)
    soup = BeautifulSoup(response.text, 'html.parser')
    # Try Open Graph meta tag first
    og_image = soup.find('meta', property='og:image')
    if og_image and og_image.get('content'):
        return og_image['content']
    # Fallback: look for main product image
    img = soup.find('img', {'class': 'product__media'})
    if img and img.get('src'):
        return img['src']
    # Fallback: first image in the page
    img = soup.find('img')
    if img and img.get('src'):
        return img['src']
    return None

# Define the tool for extract_image_url

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
    model=model_name,
    input=input_messages,
    tools=tools,
    temperature=0.0,
    
)

tool_call = response.output[0]
args = json.loads(tool_call.arguments)

result = extract_image_url(args["product_url"])

input_messages.append(tool_call)  # append model's function call message
input_messages.append({                               # append result message
    "type": "function_call_output",
    "call_id": tool_call.call_id,
    "output": str(result)
})

response_2 = client.responses.create(
    model=model_name,
    input=input_messages,
    tools=tools,
)
print(response_2.output_text)