Commands folder

Usage

- Load commands at bot startup:

```js
const commands = require('./src/commands');
commands.loadCommands();
console.log(commands.allCommands().map(c => c.name));
```

- Each command module should export: `{ name, description, async execute(ctx) }`.
- `ctx` is a flexible object provided by the pipeline/handlers (example: `{ message, reply, sender, client, services }`).

Examples included:

- `misc/ping.js` — simple test command
- `spotify/play.js` — placeholder for Spotify integration
