#!/usr/bin/env node
/**
 * Executable policy: UTC trading-hours window, with optional weekdays-only.
 *
 * policy_config:
 *   trading_hours_utc?: [startHour, endHour]   // e.g. [13, 22]  — wraps if start>end
 *   weekdays_only?: boolean                    // block Sat/Sun when true
 */

import { fileURLToPath } from "node:url";
import { runPolicyFromStdin } from "../utils/common/prompt.js";

export function check(ctx) {
  const cfg = ctx.policy_config || {};
  const window = cfg.trading_hours_utc;
  const weekdaysOnly = cfg.weekdays_only === true;

  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();  // 0=Sun, 6=Sat

  if (weekdaysOnly && (day === 0 || day === 6)) {
    return { allow: false, reason: `time-window: weekend trading disabled (UTC day ${day})` };
  }

  if (Array.isArray(window) && window.length === 2) {
    const [start, end] = window.map(Number);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const inside = start <= end ? (hour >= start && hour < end)
                                  : (hour >= start || hour < end);
      if (!inside) {
        return {
          allow: false,
          reason: `time-window: UTC hour ${hour} outside [${start}, ${end})`,
        };
      }
    }
  }
  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPolicyFromStdin(check);
}
