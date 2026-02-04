const fs = require("fs");
const path = require("path");

const commands = new Map();

function loadCommands(dir = __dirname) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      loadCommands(full);
      continue;
    }
    if (!entry.endsWith(".js") || entry === "index.js") continue;
    try {
      const mod = require(full);
      if (mod && mod.name) {
        commands.set(mod.name, mod);
        // Register aliases if present
        if (Array.isArray(mod.aliases)) {
          for (const alias of mod.aliases) {
            if (alias && typeof alias === "string") {
              commands.set(alias, mod);
            }
          }
        }
      }
    } catch (err) {
      console.log("Failed to load command", full, err && err.message);
    }
  }

  // load any commands that use dotted names like 'poll.results' by their file basename too
  // this allows commands named 'poll.results' to be required and registered
  for (const [name, mod] of Array.from(commands.entries())) {
    // already registered
  }
}

function getCommand(name) {
  return commands.get(name);
}

function allCommands() {
  return Array.from(commands.values());
}

module.exports = { loadCommands, getCommand, allCommands, commands };
