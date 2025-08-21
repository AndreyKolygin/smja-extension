console.log("Content script loaded:", location.href);

// Пример манипуляции DOM
if (!document.getElementById("my-ext-badge")) {
  const badge = document.createElement("div");
  badge.id = "my-ext-badge";
  badge.textContent = "✓ Extension Active";
  Object.assign(badge.style, {
    position: "fixed", top: "10px", right: "10px",
    padding: "6px 10px", background: "#111", color: "#fff",
    fontSize: "12px", borderRadius: "6px", zIndex: 2147483647
  });
  document.body.appendChild(badge);
}