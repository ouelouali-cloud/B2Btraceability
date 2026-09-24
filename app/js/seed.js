// Demo data: one order of recycled-cotton T-shirts for an EU brand, traced
// back to cutting waste collected from Bangladeshi garment factories.
// Three gaps are planted on purpose, one at each weak point of a real chain:
//   L-W1  the waste trader's origin declaration is incomplete
//   T3    the spinner's packing list shows gross weight (cones included)
//   P4    the garment maker booked more pieces than the fabric supports

export function seed() {
  const names = {
    waste: 'Rahman Jhut Traders',
    recy: 'GreenFibre Recycling Ltd',
    spin: 'Meghna Spinning Mills Ltd',
    mill: 'Dhaka Knit Fabrics Ltd',
    sonar: 'Sonar Apparel Ltd',
    nordvik: 'Nordvik Basics AB',
  };
  const doc = (number, date, from, to, qty, extra = {}) =>
    ({ number, date, seller: names[from], buyer: names[to], qty, ...extra });

  return {
    version: 1,
    tenantId: 'sonar',
    orgs: [
      { id: 'waste', name: names.waste, tier: 'waste', city: 'Narayanganj', country: 'BD',
        email: 'rahman.jhut@example.com', status: 'active', invitedBy: 'recy', suppliesTo: ['recy'], sc: null },
      { id: 'recy', name: names.recy, tier: 'recycler', city: 'Gazipur', country: 'BD',
        email: 'compliance@greenfibre.example.com', status: 'active', invitedBy: 'spin', suppliesTo: ['spin'],
        sc: { number: 'CU-GRS-874512', standard: 'GRS', body: 'Control Union', validFrom: '2026-02-01', validTo: '2027-01-31', scope: ['recycled-cotton-fibre'] } },
      { id: 'spin', name: names.spin, tier: 'spinner', city: 'Narsingdi', country: 'BD',
        email: 'qa@meghnaspin.example.com', status: 'active', invitedBy: 'mill', suppliesTo: ['mill'],
        sc: { number: 'IDFL-GRS-22019', standard: 'GRS', body: 'IDFL', validFrom: '2025-11-01', validTo: '2026-10-31', scope: ['oe-yarn-rco'] } },
      { id: 'mill', name: names.mill, tier: 'mill', city: 'Gazipur', country: 'BD',
        email: 'certs@dhakaknit.example.com', status: 'active', invitedBy: 'sonar', suppliesTo: ['sonar'],
        sc: { number: 'OC-GRS-50671', standard: 'GRS', body: 'OneCert', validFrom: '2026-03-15', validTo: '2027-03-14', scope: ['single-jersey'] } },
      { id: 'padma', name: 'Padma Dyeing & Finishing', tier: 'mill', city: 'Savar', country: 'BD',
        email: 'office@padmadye.example.com', status: 'invited', invitedBy: 'mill', suppliesTo: ['mill'], sc: null,
        note: 'Dyeing subcontractor to Dhaka Knit. Invited 2026-09-10, not joined yet.' },
      { id: 'sonar', name: names.sonar, tier: 'garment', city: 'Chattogram', country: 'BD',
        email: 'sustainability@sonarapparel.example.com', status: 'active', invitedBy: null, suppliesTo: ['nordvik'],
        sc: { number: 'CU-GRS-861190', standard: 'GRS', body: 'Control Union', validFrom: '2026-01-10', validTo: '2027-01-09', scope: ['tshirt'] } },
      { id: 'nordvik', name: names.nordvik, tier: 'buyer', city: 'Gothenburg', country: 'SE',
        email: 'sourcing@nordvik.example.com', status: 'active', invitedBy: null, suppliesTo: [], sc: null },
    ],
    lots: [
      { id: 'L-W1', orgId: 'waste', material: 'cotton-cutting-waste', qty: 5200, unit: 'kg', recycledPct: 100,
        recycledType: 'pre-consumer', createdAt: '2026-06-30',
        origin: {
          sources: [
            { name: 'Anwar Knit Composite', kind: 'Cutting room', city: 'Narayanganj' },
            { name: 'Fatullah Garments', kind: 'Cutting room', city: 'Narayanganj' },
          ],
          collectionFrom: '', collectionTo: '', colourSort: 'White / ecru, 100% cotton jersey',
          rmdNumber: '', rmdSigned: false,
        } },
      { id: 'L-F1', orgId: 'recy', material: 'recycled-cotton-fibre', qty: 4380, unit: 'kg', recycledPct: 100,
        recycledType: 'pre-consumer', producedBy: 'P1', createdAt: '2026-07-08' },
      { id: 'L-Y1', orgId: 'spin', material: 'oe-yarn-rco', qty: 8600, unit: 'kg', recycledPct: 40,
        recycledType: 'pre-consumer', producedBy: 'P2', createdAt: '2026-07-28', spec: 'Ne 20/1 OE, 40% recycled cotton' },
      { id: 'L-FB1', orgId: 'mill', material: 'single-jersey', qty: 2700, unit: 'kg', recycledPct: 40,
        recycledType: 'pre-consumer', producedBy: 'P3', createdAt: '2026-08-14', spec: '160 gsm single jersey, reactive dyed' },
      { id: 'L-G1', orgId: 'sonar', material: 'tshirt', qty: 14000, unit: 'pcs', kgPerUnit: 0.165, recycledPct: 40,
        recycledType: 'pre-consumer', producedBy: 'P4', createdAt: '2026-09-02', spec: 'Style NB-CREW-01, sizes S–XL' },
    ],
    transfers: [
      { id: 'T1', fromOrg: 'waste', toOrg: 'recy', lotId: 'L-W1', date: '2026-07-02', qty: 5200, receivedQty: 5150,
        tc: null,
        docs: {
          PO: doc('GF-PO-219', '2026-06-25', 'waste', 'recy', 5200, { recycledPct: 100 }),
          INVOICE: doc('RJT-0412', '2026-07-02', 'waste', 'recy', 5200),
          PACKING: doc('WB-7781', '2026-07-02', 'waste', 'recy', 5150),
        } },
      { id: 'T2', fromOrg: 'recy', toOrg: 'spin', lotId: 'L-F1', date: '2026-07-20', qty: 4000, receivedQty: 3985,
        tc: { number: 'CU-TC-2026-118204', standard: 'GRS', date: '2026-07-24', seller: names.recy, buyer: names.spin, qty: 4000, recycledPct: 100 },
        docs: {
          PO: doc('MSM-PO-5530', '2026-07-10', 'recy', 'spin', 4000, { recycledPct: 100 }),
          INVOICE: { ...doc('GF-INV-0877', '2026-07-20', 'recy', 'spin', 4000), buyer: 'Meghna Spinning Mill Ltd.' },
          PACKING: doc('GF-PL-0877', '2026-07-20', 'recy', 'spin', 4000),
        } },
      { id: 'T3', fromOrg: 'spin', toOrg: 'mill', lotId: 'L-Y1', date: '2026-08-05', qty: 3000, receivedQty: 2950,
        tc: { number: 'IDFL-TC-2026-40913', standard: 'GRS', date: '2026-08-09', seller: names.spin, buyer: names.mill, qty: 3000, recycledPct: 40 },
        docs: {
          PO: doc('DKF-PO-1102', '2026-07-28', 'spin', 'mill', 3000, { recycledPct: 40 }),
          INVOICE: doc('MSM-INV-2261', '2026-08-05', 'spin', 'mill', 3000),
          PACKING: doc('MSM-PL-2261', '2026-08-05', 'spin', 'mill', 3180),
        } },
      { id: 'T4', fromOrg: 'mill', toOrg: 'sonar', lotId: 'L-FB1', date: '2026-08-22', qty: 2600, receivedQty: 2590,
        tc: { number: 'OC-TC-2026-77310', standard: 'GRS', date: '2026-08-26', seller: names.mill, buyer: names.sonar, qty: 2600, recycledPct: 40 },
        docs: {
          PO: doc('SAL-PO-3391', '2026-08-12', 'mill', 'sonar', 2600, { recycledPct: 40 }),
          INVOICE: doc('DKF-INV-0915', '2026-08-22', 'mill', 'sonar', 2600),
          PACKING: doc('DKF-PL-0915', '2026-08-22', 'mill', 'sonar', 2600),
        } },
    ],
    processes: [
      { id: 'P1', orgId: 'recy', type: 'sorting', date: '2026-07-08', inputs: [{ transferId: 'T1', kg: 5150 }],
        outputLotId: 'L-F1', records: ['Sorting log SL-07/26', 'Shredder output sheet SO-118'] },
      { id: 'P2', orgId: 'spin', type: 'spinning', date: '2026-07-28', inputs: [{ transferId: 'T2', kg: 3985 }],
        nonClaimed: [{ material: 'virgin-cotton-fibre', kg: 6015, note: 'Virgin cotton, not claimed' }],
        outputLotId: 'L-Y1', records: ['Blend sheet BS-2207', 'Mixing room log'] },
      { id: 'P3', orgId: 'mill', type: 'knitting_dyeing', date: '2026-08-14', inputs: [{ transferId: 'T3', kg: 2950 }],
        outputLotId: 'L-FB1', records: ['Knitting plan KP-88', 'Dye batch cards DB-4410 to DB-4418'] },
      { id: 'P4', orgId: 'sonar', type: 'cut_sew', date: '2026-09-02', inputs: [{ transferId: 'T4', kg: 2590 }],
        consumption: { kgPerPc: 0.19, marker: 'MK-NB-CREW-01' },
        outputLotId: 'L-G1', records: ['Cutting report CR-0902', 'Marker MK-NB-CREW-01'] },
    ],
    claims: [
      { id: 'C1', lotId: 'L-G1', buyer: 'nordvik', date: '2026-09-18', pcs: 12000, recycledPct: 40,
        buyerPo: 'NB-PO-26-0147', text: 'Made with 40% recycled cotton (pre-consumer)', standard: 'GRS' },
    ],
    gaps: [
      { id: 'G1', key: 'L-W1:origin', owner: 'waste', raisedBy: 'sonar', raisedAt: '2026-09-12', status: 'open',
        title: 'Reclaimed material declaration',
        thread: [
          { by: 'sonar', at: '2026-09-12', text: 'Nordvik needs the origin of the jhut before we can ship. Please add the collection period, the third source factory you mentioned, and the signed declaration.' },
          { by: 'waste', at: '2026-09-14', text: 'Collected over two weeks in June. Third factory is Siddhirganj Knitwear. Will upload the signed form.' },
        ] },
    ],
  };
}
