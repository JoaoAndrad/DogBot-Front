// Example: using polls.askYesNo and listening for votes
// This example assumes it's run inside the bot process (has access to the client)

const polls = require('../frontend/src/components/poll');

// register a global listener
polls.on('vote', data => {
  console.log(
    'GLOBAL VOTE EVENT',
    data.messageId,
    data.voter,
    data.selectedNames,
    data.selectedIndexes
  );
});

// register a per-poll listener (if you know the msgId)
// polls.on(`vote:${msgId}`, data => console.log('vote for', msgId, data));

// Usage from a handler/command (example):
// await polls.askYesNo(client, '5581...@c.us', 'Deseja adicionar esta música?', { meta: { source: 'spotify' } });

console.log(
  'ask_yes_no_example loaded - call polls.askYesNo(client, chatId, question) from handlers'
);
