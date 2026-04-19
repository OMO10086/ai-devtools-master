chrome.devtools.panels.create(
  "AI Assistant",
  "",
  "src/panel/index.html",
  (panel) => {
    console.log("Panel created successfully", panel);
  }
);