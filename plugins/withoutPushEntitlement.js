const { withEntitlementsPlist } = require("expo/config-plugins");

// expo-notifications always adds the aps-environment (push) entitlement,
// but this app only schedules local reminders — never remote push. A free
// Apple "Personal Team" can't sign apps with the Push Notifications
// capability, so strip the entitlement expo-notifications adds.
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });
};
