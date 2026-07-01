function extractTextContent(content) {
  if (Array.isArray(content)) {
    return content
      .filter((block) => typeof block === "string" || block.type === "text")
      .map((block) => (typeof block === "string" ? block : block.text))
      .join("\n");
  }

  return typeof content === "string" ? content : "";
}

function normalizeRecords(records) {
  return records.map((record) => {
    const obj = {};
    record.keys.forEach((key) => {
      const value = record.get(key);
      obj[key] = typeof value === "object" && value?.toNumber
        ? value.toNumber()
        : value;
    });
    return obj;
  });
}

export { extractTextContent, normalizeRecords };
