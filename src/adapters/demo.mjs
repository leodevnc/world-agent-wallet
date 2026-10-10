export class DemoAdapter {
  async quote(service) {
    return {
      amountMicros: service.maxMicros,
      provider: "simulation",
      network: "demo",
      recipient: "demo-provider",
    };
  }
  async execute(operation) {
    let data;
    if (operation.serviceId === "bess-analysis") {
      const x = operation.input;
      const effectiveEnergy = x.energy_mwh * x.soh;
      const available = effectiveEnergy * (x.soc - x.min_soc);
      const discharge = Math.min(available, x.power_mw * x.horizon_hours);
      data = {
        kind: "illustrative_analysis",
        effective_energy_mwh: Number(effectiveEnergy.toFixed(3)),
        discharge_energy_limit_mwh: Number(discharge.toFixed(3)),
        discharge_power_limit_mw: Number(
          (discharge / x.horizon_hours).toFixed(3),
        ),
        gross_energy_value_usd: Number(
          (discharge * x.price_usd_mwh).toFixed(2),
        ),
        assumptions: [
          "Synthetic scenario; no live market data.",
          "No conversion loss, degradation cost, charging cost, or ancillary-service reservation.",
          "This is a constraint demonstration, not an optimal bid or dispatch recommendation.",
        ],
      };
    } else {
      data = {
        kind: "synthetic_market_snapshot",
        region: "ERCOT demo",
        price_usd_mwh: 95,
        volatility: "high",
        source: "local fixture — not current market data",
      };
    }
    return {
      amountMicros: operation.amountMicros,
      data,
      settlement: {
        status: "simulated",
        reference: `demo:${operation.id}`,
        network: "demo",
      },
    };
  }
}
