import os
import re

extensions = [
    "telegram", "discord", "slack", "imessage", "whatsapp", 
    "wecom", "dingtalk", "qqbot"
]

results = []
for ext in extensions:
    path = f"extensions/{ext}/src/channel.ts"
    if not os.path.exists(path):
        continue
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Try to find something like: const TelegramConfigSchema = z.object({ ... })
    match = re.search(r'const\s+\w+ConfigSchema\s*=\s*z\.object\(\{([^}]+)\}\)', content, re.DOTALL)
    if match:
        fields = re.findall(r'(\w+):\s*z\.', match.group(1))
        results.append(f"{ext}: {', '.join(fields)}")
    else:
        # Maybe configSchema inside the channel export
        match2 = re.search(r'configSchema:\s*z\.object\(\{([^}]+)\}\)', content, re.DOTALL)
        if match2:
            fields = re.findall(r'(\w+):\s*z\.', match2.group(1))
            results.append(f"{ext}: {', '.join(fields)}")
        else:
            results.append(f"{ext}: Could not parse schema with simple regex")

print("Backend Schemas Extracted:")
for res in results:
    print(res)
