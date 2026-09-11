'use strict';
function validate(value, maximum) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    return { error: 'Enter active hours as a number, using 0 if you were not woken.', code: 'active_hours_number' };
  }
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0 || hours > maximum) {
    return { error: `Active hours must be between 0 and the ${maximum}-hour shift.`, code: 'active_hours_range' };
  }
  if (!Number.isInteger(hours * 4)) return { error: 'Enter active hours in 15-minute steps (for example 2, 2.25 or 2.5). Your entry has not been rounded or saved.', code: 'active_hours_increment' };
  return { hours };
}
module.exports = { validate };
