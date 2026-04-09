/**
 * Two-user config.  All phone numbers in E.164 format (+1XXXXXXXXXX).
 * The bot identifies who is sending by matching the inbound number.
 */

function getUsers() {
  return [
    { phone: process.env.USER1_PHONE, name: process.env.USER1_NAME || "User1" },
    { phone: process.env.USER2_PHONE, name: process.env.USER2_NAME || "User2" },
  ];
}

/**
 * Given the raw "From" value from Twilio (e.g. "whatsapp:+15551234567"),
 * return { name, phone } for this user and the other user.
 */
function resolveUsers(fromRaw) {
  const phone = fromRaw.replace("whatsapp:", "");
  const users = getUsers();
  const me = users.find((u) => u.phone === phone);
  const other = users.find((u) => u.phone !== phone);
  return { me, other };
}

module.exports = { getUsers, resolveUsers };
