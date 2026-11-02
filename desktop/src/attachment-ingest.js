(function registerAttachmentIngest(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrokAttachmentIngest = api;
})(globalThis, () => {
  function hasFiles(dataTransfer) {
    // During dragover, browsers protect file contents until the actual drop.
    return Array.from(dataTransfer?.types || []).includes("Files")
      || Array.from(dataTransfer?.items || []).some((item) => item?.kind === "file")
      || Boolean(dataTransfer?.files?.length);
  }

  function filesFromDataTransfer(dataTransfer) {
    const files = Array.from(dataTransfer?.files || []).filter((file) => file && typeof file.size === "number");
    if (files.length) return files;
    return Array.from(dataTransfer?.items || [])
      .filter((item) => item?.kind === "file")
      .map((item) => item.getAsFile?.())
      .filter((file) => file && typeof file.size === "number");
  }

  return { filesFromDataTransfer, hasFiles };
});
