/**
 * Simple in-memory conversation state manager
 * For production, consider using Redis or database
 */

const states = new Map();

/**
 * Start a new conversation flow for a user
 * @param {string} userId - User identifier
 * @param {string} flowType - Type of flow (e.g., 'cadastro')
 * @param {object} initialData - Initial data for the flow
 */
function startFlow(userId, flowType, initialData = {}) {
  states.set(userId, {
    flowType,
    step: 0,
    data: initialData,
    startedAt: new Date(),
  });
}

/**
 * Get current conversation state for a user
 * @param {string} userId - User identifier
 * @returns {object|null} - State object or null if no active flow
 */
function getState(userId) {
  return states.get(userId) || null;
}

/**
 * Update conversation state data
 * @param {string} userId - User identifier
 * @param {object} updates - Data to merge into state
 */
function updateData(userId, updates) {
  const state = states.get(userId);
  if (state) {
    state.data = { ...state.data, ...updates };
    states.set(userId, state);
  }
}

/**
 * Advance to next step in the flow
 * @param {string} userId - User identifier
 */
function nextStep(userId) {
  const state = states.get(userId);
  if (state) {
    state.step += 1;
    states.set(userId, state);
  }
}

/**
 * Clear conversation state for a user
 * @param {string} userId - User identifier
 */
function clearState(userId) {
  states.delete(userId);
}

/**
 * Check if user has an active conversation flow
 * @param {string} userId - User identifier
 * @returns {boolean}
 */
function hasActiveFlow(userId) {
  return states.has(userId);
}

module.exports = {
  startFlow,
  getState,
  updateData,
  nextStep,
  clearState,
  hasActiveFlow,
};
