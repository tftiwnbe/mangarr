json=$(cat)

echo "$json" | jq -c '.[]' | while read -r extension; do
  ext_name=$(echo "$extension" | jq -r '.name // ""' | sed 's/^Tachiyomi: //')
  sources=$(echo "$extension" | jq -r '.sources // empty')
  [ -z "$sources" ] && continue

  unique_names=$(echo "$sources" | jq -r '.[].name' | sort -u | wc -l)
  [ "$unique_names" -ne 1 ] && echo "$ext_name: sources have different names"
done

echo "$json" | jq -r '.[] | .sources[]? | [.id, .name, .baseUrl] | @tsv' |
  sort | uniq -d -f0 |
  while IFS=$'\t' read -r id name url; do
    echo "Duplicate source ID found: $id (name=$name, url=$url)"
  done
