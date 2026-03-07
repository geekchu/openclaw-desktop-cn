import re

with open("ui/src/ui/views/config-channels.ts", "r", encoding="utf-8") as f:
    content = f.read()

# Try to find something like:
# const telegram: { name: string, fields: ... } = { ... }
# Or an array of channels.
matches = re.finditer(r'const\s+(\w+)\s*=\s*\{\s*name:\s*"([^"]+)",\s*fields:\s*\[([^\]]+)\]', content)
found_channels = []
for m in matches:
    channel_key = m.group(1)
    channel_name = m.group(2)
    fields_raw = m.group(3)
    
    # Extract field keys
    field_keys = re.findall(r'key:\s*"([^"]+)"', fields_raw)
    found_channels.append(f"- {channel_key} ({channel_name}): {', '.join(field_keys)}")

if found_channels:
    print("Found channels (Regex 1):")
    print("\n".join(found_channels))
else:
    # Maybe the structure is different. Let's look for "channel_type" or "fields: "
    print("No matches for Regex 1. Printing lines with 'name:' and 'key:' near 'fields:'")
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if "fields:" in line:
            print(f"L{i+1}: {line}")
            for j in range(1, 15):
                if i+j < len(lines):
                    print(f"  {lines[i+j].strip()}")
