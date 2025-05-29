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
    model=os.environ["AZURE_OPENAI_API_MODEL"],
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
    model=os.environ["AZURE_OPENAI_API_MODEL"],
    input=input_messages,
    tools=tools,
)
print(response_2.output_text)