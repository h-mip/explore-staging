const share = document.querySelector<HTMLDetailsElement>("[data-map-share]");

if (share) {
  const root = share.closest<HTMLElement>("[data-map-explorer]");
  const linkInput = share.querySelector<HTMLInputElement>("[data-share-link]");
  const codeInput = share.querySelector<HTMLTextAreaElement>("[data-share-code]");
  const status = share.querySelector<HTMLElement>("[data-share-status]");
  const embedPath = share.dataset.embedUrl;

  if (!root || !linkInput || !codeInput || !status || !embedPath) {
    throw new Error("Missing map sharing controls");
  }

  const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

  function updateFields(): void {
    const pageUrl = new URL(window.location.href);
    const embedUrl = new URL(embedPath, pageUrl.origin);
    for (const key of ["layer", "month", "view", "area", "lat", "lon", "zoom"]) {
      const value = pageUrl.searchParams.get(key);
      if (value !== null) embedUrl.searchParams.set(key, value);
    }
    linkInput.value = pageUrl.href;
    codeInput.value = `<iframe\n  src="${escapeAttribute(embedUrl.href)}"\n  title="${escapeAttribute(share.dataset.frameTitle ?? "H-MIP Explore map")}"\n  loading="lazy"\n  style="width:100%; height:600px; border:0;"\n></iframe>`;
  }

  async function copy(input: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
    updateFields();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(input.value);
      status.textContent = share.dataset.copied ?? "Copied to clipboard.";
    } catch {
      input.focus();
      input.select();
      status.textContent = share.dataset.manual ?? "Select and copy the text above.";
    }
  }

  share.addEventListener("toggle", () => {
    if (share.open) updateFields();
    status.textContent = "";
  });
  root.addEventListener("mapviewchange", () => {
    if (!share.open) return;
    updateFields();
    status.textContent = "";
  });
  share.querySelector<HTMLButtonElement>("[data-copy-link]")?.addEventListener("click", () => { void copy(linkInput); });
  share.querySelector<HTMLButtonElement>("[data-copy-code]")?.addEventListener("click", () => { void copy(codeInput); });
  document.addEventListener("pointerdown", (event) => {
    if (share.open && !share.contains(event.target as Node)) share.open = false;
  });
  share.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      share.open = false;
      share.querySelector<HTMLElement>("summary")?.focus();
    }
  });
}
