/**
 * Get push name from WhatsApp contact
 * @param {string} senderNumber - Phone number without @c.us
 * @param {Object} client - WhatsApp client instance (optional)
 * @returns {Promise<string>} User's push name or phone number
 */
async function getPushName(senderNumber, client = null) {
  if (!senderNumber) return "Anônimo";

  // If client is provided, try to fetch from WhatsApp
  if (client) {
    try {
      const whatsappId = senderNumber.includes("@")
        ? senderNumber
        : `${senderNumber}@c.us`;

      const contact = await client.getContactById(whatsappId);
      return contact?.pushname || contact?.name || senderNumber;
    } catch (err) {
      // Silently fail and return phone number
    }
  }

  return senderNumber;
}

module.exports = getPushName;
