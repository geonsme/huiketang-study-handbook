import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { calculate } from "../scripts/portfolio_check.mjs";

function fixture() {
  return {
    currency: "CNY", as_of: "2026-10-24",
    monthly_essential_outflow: 15000, stressed_monthly_income: 5000,
    reserve_months: 12, committed_outflows: 20000, loss_budget: 150000,
    holdings: [
      { name: "cash", amount: 200000, liquid_reserve: true, target_weight: 0.2 },
      { name: "equity", amount: 500000, liquid_reserve: false, target_weight: 0.5 },
      { name: "bond", amount: 300000, liquid_reserve: false, target_weight: 0.3 },
    ],
    scenarios: [{ name: "stress", returns: { cash: 0, equity: -0.3, bond: -0.05 } }],
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("known household arithmetic keeps market losses separate from spending", () => {
  const input = fixture();
  const copy = structuredClone(input);
  const output = calculate(input);
  assert.deepEqual(input, copy);
  assert.equal(output.total_assets, 1000000);
  assert.equal(output.liquidity.monthly_shortfall, 10000);
  assert.equal(output.liquidity.reserve_target, 140000);
  assert.equal(output.liquidity.reserve_gap, 0);
  assert.equal(output.liquidity.reserve_surplus, 60000);
  assert.equal(output.liquidity.months_after_commitments, 18);
  assert.equal(output.scenarios[0].pnl, -165000);
  assert.equal(output.scenarios[0].stressed_portfolio_value, 835000);
  close(output.scenarios[0].portfolio_return, -0.165);
  close(output.scenarios[0].positions.reduce((sum, item) => sum + item.portfolio_return_contribution, 0), -0.165);
  assert.equal(output.scenarios[0].loss_budget_exceeded, true);
});

test("target differences are arithmetic only and can be omitted", () => {
  const input = fixture();
  input.holdings[0].target_weight = 0.3;
  input.holdings[1].target_weight = 0.4;
  const output = calculate(input);
  close(output.holdings[0].weight_drift, -0.1);
  assert.equal(output.holdings[0].target_gap_amount, 100000);
  assert.equal(output.holdings[1].target_gap_amount, -100000);
  for (const holding of input.holdings) delete holding.target_weight;
  assert.equal(Object.hasOwn(calculate(input).holdings[0], "target_gap_amount"), false);
});

test("no monthly deficit does not erase an unfunded committed payment", () => {
  const input = fixture();
  input.stressed_monthly_income = 20000;
  input.committed_outflows = 300000;
  const output = calculate(input);
  assert.equal(output.liquidity.monthly_shortfall, 0);
  assert.equal(output.liquidity.months_after_commitments, null);
  assert.equal(output.liquidity.reserve_gap, 100000);
  assert.match(output.liquidity.runway_status, /no_monthly_shortfall/);
});

test("risky or locked assets are not silently counted as reserves", () => {
  const input = fixture();
  input.holdings[0].liquid_reserve = false;
  const output = calculate(input);
  assert.equal(output.liquidity.eligible_reserves, 0);
  assert.equal(output.liquidity.reserve_gap, 140000);
  assert.equal(output.liquidity.months_after_commitments, 0);
});

test("loss of reserve availability changes liquidity but not asset ownership", () => {
  const input = fixture();
  input.scenarios[0].unavailable_reserves = ["cash"];
  const output = calculate(input);
  assert.equal(output.scenarios[0].stressed_portfolio_value, 835000);
  assert.equal(output.scenarios[0].liquidity.eligible_reserves, 0);
  assert.equal(output.scenarios[0].liquidity.reserve_gap, 140000);
});

test("reserve assets also take their explicit market stress", () => {
  const input = fixture();
  input.scenarios[0].returns.cash = -0.5;
  const output = calculate(input);
  assert.equal(output.scenarios[0].liquidity.eligible_reserves, 100000);
  assert.equal(output.scenarios[0].liquidity.reserve_gap, 40000);
  assert.equal(output.scenarios[0].liquidity.months_after_commitments, 8);
});

test("total long-only loss is valid and an absent budget stays unknown", () => {
  const input = fixture();
  input.scenarios[0].returns = { cash: -1, equity: -1, bond: -1 };
  delete input.loss_budget;
  const result = calculate(input).scenarios[0];
  assert.equal(result.stressed_portfolio_value, 0);
  assert.equal(result.portfolio_return, -1);
  assert.equal(result.loss_budget_exceeded, null);
  assert.equal(result.loss_budget, null);
});

test("budget checks use net portfolio loss and expose gross position losses separately", () => {
  const input = fixture();
  input.scenarios[0].returns.equity = 0.2;
  input.loss_budget = 0;
  const result = calculate(input).scenarios[0];
  assert.equal(result.pnl, 85000);
  assert.equal(result.net_loss, 0);
  assert.equal(result.gross_position_losses, 15000);
  assert.equal(result.loss_budget_exceeded, false);
});

test("floating-point noise at a budget boundary is not treated as an overrun", () => {
  const input = fixture();
  input.holdings = [{ name: "asset", amount: 3, liquid_reserve: false }];
  input.scenarios = [{ name: "boundary", returns: { asset: -0.1 } }];
  input.loss_budget = 0.3;
  assert.equal(calculate(input).scenarios[0].loss_budget_exceeded, false);
  input.loss_budget = 0.29;
  assert.equal(calculate(input).scenarios[0].loss_budget_exceeded, true);
});

test("zero holdings are allowed in a positive portfolio", () => {
  const input = fixture();
  input.holdings[1].amount = 0;
  const output = calculate(input);
  assert.equal(output.holdings[1].weight, 0);
  assert.equal(output.scenarios[0].positions[1].pnl, 0);
});

test("omitting scenarios reports no market stress rather than inventing returns", () => {
  const input = fixture();
  delete input.scenarios;
  const output = calculate(input);
  assert.deepEqual(output.scenarios, []);
  assert.ok(output.warnings.some((warning) => warning.includes("not been market-stress-tested")));
});

const invalidCases = [
  ["missing cash return", (x) => { delete x.scenarios[0].returns.cash; }, /missing explicit return/],
  ["unknown return", (x) => { x.scenarios[0].returns.unknown = 0; }, /unknown holding/],
  ["short or leveraged loss", (x) => { x.scenarios[0].returns.equity = -1.1; }, /must be >= -1/],
  ["non-numeric return", (x) => { x.scenarios[0].returns.equity = "0.1"; }, /finite number/],
  ["negative holding", (x) => { x.holdings[0].amount = -1; }, /must be >= 0/],
  ["NaN holding", (x) => { x.holdings[0].amount = NaN; }, /finite number/],
  ["infinite income", (x) => { x.stressed_monthly_income = Infinity; }, /finite number/],
  ["missing stressed income", (x) => { delete x.stressed_monthly_income; }, /finite number/],
  ["negative commitment", (x) => { x.committed_outflows = -1; }, /must be >= 0/],
  ["zero reserve horizon", (x) => { x.reserve_months = 0; }, /positive/],
  ["negative budget", (x) => { x.loss_budget = -1; }, /must be >= 0/],
  ["missing reserve classification", (x) => { delete x.holdings[0].liquid_reserve; }, /explicitly true or false/],
  ["duplicate holding", (x) => { x.holdings[1].name = "cash"; }, /Duplicate holding/],
  ["duplicate scenario", (x) => { x.scenarios.push(structuredClone(x.scenarios[0])); }, /Duplicate scenario/],
  ["partial target weights", (x) => { delete x.holdings[0].target_weight; }, /every holding or none/],
  ["targets do not sum to one", (x) => { x.holdings[0].target_weight = 0.5; }, /sum to 1/],
  ["negative target", (x) => { x.holdings[0].target_weight = -0.1; }, /must be >= 0/],
  ["target above one", (x) => { x.holdings[0].target_weight = 1.1; }, /must be <= 1/],
  ["unavailable non-reserve", (x) => { x.scenarios[0].unavailable_reserves = ["equity"]; }, /not an eligible reserve/],
  ["duplicate unavailable reserve", (x) => { x.scenarios[0].unavailable_reserves = ["cash", "cash"]; }, /duplicate unavailable/],
  ["invalid date", (x) => { x.as_of = "2026-02-30"; }, /real calendar date/],
  ["empty holdings", (x) => { x.holdings = []; }, /non-empty array/],
  ["zero total", (x) => { x.holdings.forEach((holding) => { holding.amount = 0; }); }, /Total assets must be positive/],
  ["unknown input field", (x) => { x.reserve_month = 12; }, /unknown field/],
  ["null scenarios", (x) => { x.scenarios = null; }, /must be an array/],
  ["overflowing total", (x) => { x.holdings[0].amount = Number.MAX_VALUE; x.holdings[1].amount = Number.MAX_VALUE; }, /overflowed/],
  ["overflowing budget", (x) => { x.monthly_essential_outflow = Number.MAX_VALUE; }, /overflowed/],
  ["overflowing stress", (x) => { x.scenarios[0].returns.equity = Number.MAX_VALUE; }, /overflowed/],
];

for (const [name, mutate, expected] of invalidCases) {
  test(`rejects ${name}`, () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => calculate(input), expected);
  });
}

test("the documented JSON example executes through the actual read-only CLI", (t) => {
  const document = readFileSync(new URL("../references/household.md", import.meta.url), "utf8");
  const example = JSON.parse(document.match(/```json\n([\s\S]*?)\n```/u)[1]);
  const root = mkdtempSync(join(tmpdir(), "huiketang-portfolio-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "household.json");
  const bytes = `${JSON.stringify(example)}\n`;
  writeFileSync(path, bytes);
  const script = fileURLToPath(new URL("../scripts/portfolio_check.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--input", path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).scenarios[0].net_loss, 165000);
  assert.equal(readFileSync(path, "utf8"), bytes);
  const link = join(root, "portfolio_check.mjs");
  symlinkSync(script, link);
  const viaLink = spawnSync(process.execPath, [link, "--input", path], { cwd: root, encoding: "utf8" });
  assert.equal(viaLink.status, 0, viaLink.stderr);
  assert.equal(JSON.parse(viaLink.stdout).total_assets, 1000000);
  const invalid = spawnSync(process.execPath, [script, "--unknown"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
});
