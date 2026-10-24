#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, path, allowed) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  if (!allowed) return;
  for (const key of Object.keys(value)) {
    assert(allowed.includes(key), `${path}: unknown field ${key}`);
  }
}

function number(value, path, minimum = 0) {
  assert(typeof value === "number" && Number.isFinite(value), `${path} must be a finite number`);
  assert(value >= minimum, `${path} must be >= ${minimum}`);
  return value;
}

function text(value, path) {
  assert(typeof value === "string" && value.length > 0 && value.trim() === value, `${path} must be non-empty text without outer whitespace`);
}

function finite(value, path) {
  assert(Number.isFinite(value), `${path} overflowed; check units and magnitudes`);
  return value === 0 ? 0 : value;
}

function sum(values, path) {
  return finite(values.reduce((total, value) => total + value, 0), path);
}

function exceedsBudget(loss, budget) {
  // Ignore IEEE-754 roundoff at the boundary, not actual currency differences.
  const roundoff = Number.EPSILON * 16 * Math.max(1, loss, budget);
  return loss - budget > roundoff;
}

export function validateInput(input) {
  record(input, "input", [
    "currency", "as_of", "monthly_essential_outflow", "stressed_monthly_income",
    "reserve_months", "committed_outflows", "loss_budget", "holdings", "scenarios",
  ]);
  assert(typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency), "currency must be a three-letter uppercase label");
  assert(typeof input.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of), "as_of must be YYYY-MM-DD");
  const date = new Date(`${input.as_of}T00:00:00Z`);
  assert(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input.as_of, "as_of must be a real calendar date");
  for (const key of ["monthly_essential_outflow", "stressed_monthly_income", "reserve_months", "committed_outflows"]) {
    number(input[key], key);
  }
  assert(input.reserve_months > 0, "reserve_months must be positive");
  if (Object.hasOwn(input, "loss_budget")) number(input.loss_budget, "loss_budget");

  assert(Array.isArray(input.holdings) && input.holdings.length > 0, "holdings must be a non-empty array");
  const names = new Set();
  for (const [i, holding] of input.holdings.entries()) {
    const path = `holdings[${i}]`;
    record(holding, path, ["name", "amount", "liquid_reserve", "target_weight"]);
    text(holding.name, `${path}.name`);
    assert(!names.has(holding.name), `Duplicate holding: ${holding.name}`);
    names.add(holding.name);
    number(holding.amount, `${path}.amount`);
    assert(typeof holding.liquid_reserve === "boolean", `${path}.liquid_reserve must be explicitly true or false`);
    if (Object.hasOwn(holding, "target_weight")) {
      number(holding.target_weight, `${path}.target_weight`);
      assert(holding.target_weight <= 1, `${path}.target_weight must be <= 1`);
    }
  }
  const total = sum(input.holdings.map((holding) => holding.amount), "Total assets");
  assert(total > 0, "Total assets must be positive");
  const targeted = input.holdings.filter((holding) => Object.hasOwn(holding, "target_weight"));
  assert(targeted.length === 0 || targeted.length === input.holdings.length, "Provide target_weight for every holding or none");
  if (targeted.length) {
    assert(
      Math.abs(sum(targeted.map((holding) => holding.target_weight), "Target weights") - 1) <= 1e-9,
      "Target weights must sum to 1",
    );
  }

  const scenarios = input.scenarios === undefined ? [] : input.scenarios;
  assert(Array.isArray(scenarios), "scenarios must be an array");
  const scenarioNames = new Set();
  const reserveNames = new Set(input.holdings.filter((holding) => holding.liquid_reserve).map((holding) => holding.name));
  for (const [i, scenario] of scenarios.entries()) {
    const path = `scenarios[${i}]`;
    record(scenario, path, ["name", "returns", "unavailable_reserves"]);
    text(scenario.name, `${path}.name`);
    assert(!scenarioNames.has(scenario.name), `Duplicate scenario: ${scenario.name}`);
    scenarioNames.add(scenario.name);
    record(scenario.returns, `${path}.returns`);
    for (const name of names) {
      assert(Object.hasOwn(scenario.returns, name), `${path}: missing explicit return for ${name}`);
      number(scenario.returns[name], `${path}.returns[${name}]`, -1);
    }
    for (const name of Object.keys(scenario.returns)) {
      assert(names.has(name), `${path}: return for unknown holding ${name}`);
    }
    if (Object.hasOwn(scenario, "unavailable_reserves")) {
      assert(Array.isArray(scenario.unavailable_reserves), `${path}.unavailable_reserves must be an array`);
      const unavailable = new Set();
      for (const name of scenario.unavailable_reserves) {
        assert(reserveNames.has(name), `${path}: unavailable reserve is not an eligible reserve: ${name}`);
        assert(!unavailable.has(name), `${path}: duplicate unavailable reserve ${name}`);
        unavailable.add(name);
      }
    }
  }
  return { ...input, scenarios };
}

function liquidity(input, eligibleReserves) {
  const shortfall = Math.max(input.monthly_essential_outflow - input.stressed_monthly_income, 0);
  const target = finite(shortfall * input.reserve_months + input.committed_outflows, "Reserve target");
  const afterCommitments = Math.max(eligibleReserves - input.committed_outflows, 0);
  return {
    monthly_shortfall: shortfall,
    reserve_months: input.reserve_months,
    committed_outflows: input.committed_outflows,
    reserve_target: target,
    eligible_reserves: eligibleReserves,
    reserve_gap: Math.max(target - eligibleReserves, 0),
    reserve_surplus: Math.max(eligibleReserves - target, 0),
    months_after_commitments: shortfall > 0 ? finite(afterCommitments / shortfall, "Liquidity runway") : null,
    runway_status: shortfall > 0 ? "calculated_from_stressed_cash_flow" : "no_monthly_shortfall_not_a_lifetime_guarantee",
  };
}

export function calculate(rawInput) {
  const input = validateInput(rawInput);
  const total = sum(input.holdings.map((holding) => holding.amount), "Total assets");
  const reserves = sum(input.holdings.filter((holding) => holding.liquid_reserve).map((holding) => holding.amount), "Eligible reserves");
  const hasTargets = Object.hasOwn(input.holdings[0], "target_weight");
  const holdings = input.holdings.map((holding) => ({
    name: holding.name,
    amount: holding.amount,
    liquid_reserve: holding.liquid_reserve,
    weight: holding.amount / total,
    ...(hasTargets ? {
      target_weight: holding.target_weight,
      weight_drift: holding.amount / total - holding.target_weight,
      target_amount: total * holding.target_weight,
      target_gap_amount: total * holding.target_weight - holding.amount,
    } : {}),
  }));
  const scenarios = input.scenarios.map((scenario) => {
    const unavailable = new Set(scenario.unavailable_reserves ?? []);
    const positions = input.holdings.map((holding) => {
      const rate = scenario.returns[holding.name];
      const pnl = finite(holding.amount * rate, `P&L for ${holding.name}`);
      const after = finite(holding.amount * (1 + rate), `Stressed amount for ${holding.name}`);
      return {
        name: holding.name,
        return: rate,
        pnl,
        portfolio_return_contribution: pnl / total,
        stressed_amount: after,
        eligible_reserve_after_stress: holding.liquid_reserve && !unavailable.has(holding.name),
      };
    });
    const pnl = sum(positions.map((position) => position.pnl), "Scenario P&L");
    const netLoss = Math.max(-pnl, 0);
    const stressedReserves = sum(
      positions.filter((position) => position.eligible_reserve_after_stress).map((position) => position.stressed_amount),
      "Stressed eligible reserves",
    );
    return {
      name: scenario.name,
      positions,
      pnl,
      portfolio_return: finite(pnl / total, "Scenario return"),
      stressed_portfolio_value: sum(positions.map((position) => position.stressed_amount), "Stressed portfolio value"),
      net_loss: netLoss,
      gross_position_losses: sum(positions.map((position) => Math.max(-position.pnl, 0)), "Gross position losses"),
      loss_budget: input.loss_budget ?? null,
      loss_budget_exceeded: Object.hasOwn(input, "loss_budget") ? exceedsBudget(netLoss, input.loss_budget) : null,
      unavailable_reserves: [...unavailable],
      // A budget check is separate from the one-time market shock, not another portfolio loss.
      liquidity: liquidity(input, stressedReserves),
    };
  });
  const warnings = [
    "User-supplied returns are scenarios, not forecasts, probabilities, or maximum possible losses.",
    "All amounts must use one currency in base units. No FX conversion, tax, fee, leverage, or margin model is applied.",
    "Only reserves explicitly marked eligible count. Availability is an input, not independently verified.",
    "Future spending is not subtracted from stressed portfolio values. The liquidity budget is a separate check.",
    "Target gaps are arithmetic comparisons, not trade instructions. No orders are submitted.",
  ];
  if (!scenarios.length) warnings.push("No market scenarios supplied; the portfolio has not been market-stress-tested.");
  return {
    schema_version: 1,
    currency: input.currency,
    as_of: input.as_of,
    total_assets: total,
    holdings,
    liquidity: liquidity(input, reserves),
    scenarios,
    warnings,
  };
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 0 || (args.length === 1 && ["--help", "help"].includes(args[0]))) {
    console.log(`Usage: node scripts/portfolio_check.mjs --input /absolute/path/household.json

Read-only, long-only portfolio and liquidity arithmetic. See references/household.md
for the schema. Returns and target weights use decimals, amounts use base currency
units. Every holding needs an explicit return in every scenario. Output is JSON.
The tool does not access the network, persist inputs, recommend targets, or trade.`);
    return;
  }
  assert(args.length === 2 && args[0] === "--input", "Expected --input FILE; use --help for usage");
  const input = JSON.parse(readFileSync(resolve(args[1]), "utf8"));
  console.log(JSON.stringify(calculate(input), null, 2));
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
