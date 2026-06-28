const fetch = require("node-fetch");
const querystring = require("querystring");

const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const BOT_SECRET = process.env.BOT_SECRET || process.env.INTERNAL_API_SECRET || "";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "x-bot-secret": BOT_SECRET,
  };
}

async function _post(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

async function _get(path, params) {
  const qs = params ? `?${querystring.stringify(params)}` : "";
  const res = await fetch(`${BACKEND_URL}${path}${qs}`, { headers: authHeaders() });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

async function startAuth(userId) {
  return _post("/api/financial/auth/start", { userId });
}

async function checkAuthStatus(userId) {
  return _get("/api/financial/auth/status", { userId });
}

// Accounts

async function listAccounts(userId) {
  return _get("/api/financial/accounts", { userId });
}

async function createAccount(userId, { name, type, balance = 0, isDefault = false }) {
  return _post("/api/financial/accounts", { userId, name, type, balance, isDefault });
}

async function updateAccount(userId, accountId, fields) {
  const res = await fetch(`${BACKEND_URL}/api/financial/accounts/${accountId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ userId, ...fields }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

async function deleteAccount(userId, accountId) {
  const res = await fetch(`${BACKEND_URL}/api/financial/accounts/${accountId}?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

// Categories

async function listCategories(userId) {
  return _get("/api/financial/categories", { userId });
}

async function createCategory(userId, { name, parentId }) {
  return _post("/api/financial/categories", { userId, name, parentId });
}

async function deleteCategory(userId, categoryId) {
  const res = await fetch(`${BACKEND_URL}/api/financial/categories/${categoryId}?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

// Transactions

async function listTransactions(userId, { period = "current", accountId, limit = 30, skip = 0 } = {}) {
  const params = { userId, period, limit, skip };
  if (accountId) params.accountId = accountId;
  return _get("/api/financial/transactions", params);
}

async function createTransaction(userId, { accountId, amount, description, type, date, categoryId, status, recurrence, recurrenceDay }) {
  return _post("/api/financial/transactions", { userId, accountId, amount, description, type, date, categoryId, status, recurrence, recurrenceDay });
}

async function listScheduled(userId) {
  return _get("/api/financial/transactions/scheduled", { userId });
}

async function confirmTransaction(userId, transactionId) {
  return _post(`/api/financial/transactions/${transactionId}/confirm`, { userId });
}

async function skipTransaction(userId, transactionId) {
  return _post(`/api/financial/transactions/${transactionId}/skip`, { userId });
}

async function createInstallment(userId, { accountId, amount, description, type, date, categoryId, installmentCount }) {
  return _post("/api/financial/transactions/installment", { userId, accountId, amount, description, type, date, categoryId, installmentCount });
}

async function deleteTransaction(userId, transactionId) {
  const res = await fetch(`${BACKEND_URL}/api/financial/transactions/${transactionId}?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

// Cards

async function listCards(userId) {
  return _get("/api/financial/cards", { userId });
}

async function createCard(userId, { name, limit, closingDay, dueDay, linkedAccountId }) {
  return _post("/api/financial/cards", { userId, name, limit, closingDay, dueDay, linkedAccountId });
}

async function deleteCard(userId, cardId) {
  const res = await fetch(`${BACKEND_URL}/api/financial/cards/${cardId}?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

async function getCurrentInvoice(userId, cardId) {
  return _get(`/api/financial/cards/${cardId}/invoices/current`, { userId });
}

async function listInvoices(userId, cardId) {
  return _get(`/api/financial/cards/${cardId}/invoices`, { userId });
}

async function payInvoice(userId, cardId, invoiceId, { accountId, amount }) {
  return _post(`/api/financial/cards/${cardId}/invoices/${invoiceId}/pay`, { userId, accountId, amount });
}

// Budgets

async function listBudgets(userId) {
  return _get("/api/financial/budgets", { userId });
}

async function createBudget(userId, { categoryId, limit, period = "monthly" }) {
  return _post("/api/financial/budgets", { userId, categoryId, limit, period });
}

async function deleteBudget(userId, budgetId) {
  const res = await fetch(`${BACKEND_URL}/api/financial/budgets/${budgetId}?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

module.exports = {
  startAuth, checkAuthStatus,
  listAccounts, createAccount, updateAccount, deleteAccount,
  listCategories, createCategory, deleteCategory,
  listTransactions, createTransaction, createInstallment, deleteTransaction,
  listScheduled, confirmTransaction, skipTransaction,
  listBudgets, createBudget, deleteBudget,
  listCards, createCard, deleteCard,
  getCurrentInvoice, listInvoices, payInvoice,
};
