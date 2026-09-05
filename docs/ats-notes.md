## Day 1 results — first bond issued

| | |
|---|---|
| Bond contract | `0.0.10373584` |
| EVM address | `0x13c8ca9a1f58c5e953209477146891dcfcaa8741` |
| Issued via factory | `0.0.9213391` |
| Type returned | `BOND_VARIABLE_RATE` |
| Issuance cost | 7.42171367 ℏ = **$0.586** @ HBAR $0.0790 |

### Required values, learned the hard way

- Timestamps are **milliseconds**, not seconds
- `regulationType: 1` (REG_S) requires `regulationSubType: 0` (NONE)
- `configId` for bonds is `0x…0002`; `configVersion: 1`
- All optional array fields must be passed as `[]`, not omitted
- `Network.init()` must be called **again after** `Network.connect()`

### On zero-coupon

ATS has no zero-coupon bond type. `CreateBondRequest` produces `BOND_VARIABLE_RATE` — the
coupon is simply never set. Economically equivalent for Forfait: the funder's return is the
discount to face value, realised at maturity. Worth stating precisely rather than claiming
ATS offers a zero-coupon instrument.

### Cost note

Issuance is an EVM contract deployment, so it costs ~$0.59 — not the sub-cent figures of
native HTS/HCS operations. On a $2,000 invoice that is 0.03% of face value.