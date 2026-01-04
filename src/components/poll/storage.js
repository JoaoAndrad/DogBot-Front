const url = require("url");

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const INTERNAL_SECRET = process.env.POLL_SHARED_SECRET || null;

let _fetch = global.fetch;
if (!_fetch) {
  try {
    // try node-fetch as fallback
    // eslint-disable-next-line global-require
    _fetch = require("node-fetch");
  } catch (e) {
    throw new Error(
      "No fetch available. Install node-fetch or run on Node 18+."
    );
  }
}

function _headers() {
  const h = { "Content-Type": "application/json" };
  if (INTERNAL_SECRET) h["X-Internal-Secret"] = INTERNAL_SECRET;
  return h;
}

async function savePoll(msgId, poll) {
  const payload = {
    id: msgId,
    chat_id: poll.chatId || poll.chat_id,
    title: poll.title,
    options: poll.options || poll.options || [],
    poll_options: poll.pollOptions || poll.poll_options || [],
    options_obj: poll.optionsObj || poll.options_obj || {},
    type: poll.type || "native",
    vote_type: poll.voteType || poll.vote_type || null,
    vote_id: poll.voteId || poll.vote_id || null,
    group_id: poll.groupId || poll.group_id || null,
  };
  const res = await _fetch(url.resolve(BACKEND_URL, "/api/polls/"), {
    method: "POST",
    headers: _headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`savePoll failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function getPoll(msgId) {
  const res = await _fetch(
    url.resolve(BACKEND_URL, `/api/polls/${encodeURIComponent(msgId)}/`),
    {
      method: "GET",
      headers: _headers(),
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`getPoll failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function listPolls() {
  const res = await _fetch(url.resolve(BACKEND_URL, "/api/polls/"), {
    method: "GET",
    headers: _headers(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`listPolls failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function findPollsByChat(chatId) {
  const u = new URL("/api/polls/", BACKEND_URL);
  u.searchParams.set("chat_id", chatId);
  const res = await _fetch(u.toString(), {
    method: "GET",
    headers: _headers(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`findPollsByChat failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function removePoll(msgId) {
  const res = await _fetch(
    url.resolve(BACKEND_URL, `/api/polls/${encodeURIComponent(msgId)}/`),
    {
      method: "DELETE",
      headers: _headers(),
    }
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`removePoll failed: ${res.status} ${txt}`);
  }
  return true;
}

async function recordVote(
  msgId,
  voterId,
  selectedOptions,
  selectedIndexes = [],
  selectedNames = []
) {
  const payload = {
    voter_id: voterId,
    selected_options: selectedOptions,
    selected_indexes: selectedIndexes,
    selected_names: selectedNames,
  };

  const res = await _fetch(
    url.resolve(BACKEND_URL, `/api/polls/${encodeURIComponent(msgId)}/votes/`),
    {
      method: "POST",
      headers: _headers(),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`recordVote failed: ${res.status} ${txt}`);
  }
  return res.json();
}

module.exports = {
  savePoll,
  getPoll,
  removePoll,
  recordVote,
  listPolls,
  findPollsByChat,
};
