export const tenants = [
  {
    id: 'acme-law', name: 'Acme Legal', industry: 'Law firm',
    connectors: [
      { id: 'crm-acme', type: 'crm', name: 'Legacy CRM', status: 'healthy', lastSync: '2026-07-15T11:58:00.000Z', recordCount: 9 },
      { id: 'drive-acme', type: 'drive', name: 'Team Drive', status: 'healthy', lastSync: '2026-07-15T11:56:00.000Z', recordCount: 10 },
      { id: 'jira-acme', type: 'jira', name: 'Jira Cloud', status: 'demo', lastSync: '2026-07-15T11:55:00.000Z', recordCount: 5 }
    ]
  },
  {
    id: 'northstar', name: 'Northstar Advisory', industry: 'Consulting',
    connectors: [
      { id: 'crm-north', type: 'crm', name: 'Northstar CRM', status: 'healthy', lastSync: '2026-07-15T11:51:00.000Z', recordCount: 5 }
    ]
  }
];

export const records = [
  // Acme CRM: official owner is useless; Assigned To contains the business truth.
  { tenantId:'acme-law', source:'crm', entity:'deal', id:'D-101', fields:{ title:'Orchid Retainer', official_owner:'Shared Account', 'Assigned To':'Garima', official_status:'active', folder:'Hot Pipeline', amount:'₹1,20,000', created_at:'2026-06-04' } },
  { tenantId:'acme-law', source:'crm', entity:'deal', id:'D-102', fields:{ title:'Maple Advisory', official_owner:'Shared Account', 'Assigned To':'Garima S.', official_status:'', folder:'Follow Up', amount:'85000', created_at:'2026-07-02' } },
  { tenantId:'acme-law', source:'crm', entity:'deal', id:'D-103', fields:{ title:'Cedar Dispute', official_owner:'Shared Account', 'Assigned To':'garima', official_status:'active', folder:'Dead Leads', amount:'₹65,000', created_at:'2026-06-14' } },
  { tenantId:'acme-law', source:'crm', entity:'deal', id:'D-104', fields:{ title:'Pine Compliance', official_owner:'Shared Account', 'Assigned To':'Rahul', official_status:'open', folder:'Qualified', amount:'₹2,10,000', created_at:'2026-07-06' } },
  { tenantId:'acme-law', source:'crm', entity:'deal', id:'D-105', fields:{ title:'Birch Filing', official_owner:'Shared Account', 'Assigned To':'Garma', official_status:'active', folder:'Negotiation', amount:'78000', created_at:'2026-07-08' } },
  { tenantId:'acme-law', source:'crm', entity:'deal', id:'D-106', fields:{ title:'Ash Contract', official_owner:'Shared Account', 'Assigned To':'Garima', official_status:'closed', folder:'Completed', amount:'50000', created_at:'2026-05-03' } },
  // Filing cases in CRM. “Submitted” is useful, but acknowledgement is stronger evidence.
  { tenantId:'acme-law', source:'crm', entity:'filing', id:'F-201', fields:{ client:'ABC Private Limited', service_type:'ITR', workflow_state:'Submitted', submission_date:'2026-06-18', acknowledgement_no:'ACK-ABC-8842', assessment_year:'2025-26' } },
  { tenantId:'acme-law', source:'crm', entity:'filing', id:'F-202', fields:{ client:'Bright Retail', service_type:'Income Tax', workflow_state:'Prepared', submission_date:'', acknowledgement_no:'', assessment_year:'2025-26' } },
  { tenantId:'acme-law', source:'crm', entity:'filing', id:'F-203', fields:{ client:'Cedar Works', service_type:'IT Return', workflow_state:'Filed', submission_date:'2026-06-27', acknowledgement_no:'', assessment_year:'2025-26' } },
  // Drive metadata: modified dates alone are weak; acknowledgement document type is strong.
  { tenantId:'acme-law', source:'drive', entity:'file', id:'G-301', fields:{ client_hint:'ABC Pvt Ltd', name:'ITR_ACK_AY25-26.pdf', folder:'/Clients/ABC/Income Tax/AY25-26', document_kind:'acknowledgement', modified_at:'2026-06-18', checksum:'sha-abc-ack', linked_case:'F-201' } },
  { tenantId:'acme-law', source:'drive', entity:'file', id:'G-302', fields:{ client_hint:'ABC Private Ltd', name:'ITR_ACK_copy.pdf', folder:'/Team/Recent Uploads', document_kind:'acknowledgement', modified_at:'2026-06-19', checksum:'sha-abc-ack', linked_case:'F-201' } },
  { tenantId:'acme-law', source:'drive', entity:'file', id:'G-303', fields:{ client_hint:'Bright Retail', name:'Draft_ITR_v4.pdf', folder:'/Clients/Bright/ITR', document_kind:'draft', modified_at:'2026-06-21', checksum:'sha-bright-draft4', linked_case:'F-202' } },
  { tenantId:'acme-law', source:'drive', entity:'file', id:'G-304', fields:{ client_hint:'Cedar Works', name:'final_return.pdf', folder:'/Clients/Cedar/Tax Return', document_kind:'final_return', modified_at:'2026-06-28', checksum:'sha-cedar-final', linked_case:'F-203' } },
  { tenantId:'acme-law', source:'drive', entity:'file', id:'G-305', fields:{ client_hint:'Delta Foods', name:'ITR_2026', folder:'/Clients/Delta/Completed', document_kind:'folder_marker', modified_at:'2026-06-20', checksum:'', linked_case:'' } },
  // Jira demo records: real assignee is custom PIC; archived column overrides active status.
  { tenantId:'acme-law', source:'jira', entity:'task', id:'T-401', fields:{ key:'LEGAL-101', summary:'Prepare ABC filing', assignee:'Shared Bot', PIC:'Meera', status:'In Progress', board_column:'Doing', labels:['tax','client-work'], updated:'2026-07-12' } },
  { tenantId:'acme-law', source:'jira', entity:'task', id:'T-402', fields:{ key:'LEGAL-102', summary:'Review contract', assignee:'Shared Bot', PIC:'Meera K.', status:'Active', board_column:'Archive', labels:['contracts'], updated:'2026-07-10' } },
  { tenantId:'acme-law', source:'jira', entity:'task', id:'T-403', fields:{ key:'LEGAL-103', summary:'GST response', assignee:'Shared Bot', PIC:'Meera', status:'', board_column:'Review', labels:['blocked-client'], updated:'2026-07-14' } },
  { tenantId:'acme-law', source:'jira', entity:'task', id:'T-404', fields:{ key:'LEGAL-104', summary:'Client onboarding', assignee:'Shared Bot', PIC:'Rahul', status:'Open', board_column:'Backlog', labels:[], updated:'2026-07-14' } },
  { tenantId:'acme-law', source:'jira', entity:'task', id:'T-405', fields:{ key:'LEGAL-105', summary:'Close old matter', assignee:'Shared Bot', PIC:'Meera', status:'Done', board_column:'Review', labels:[], updated:'2026-07-11' } },
  // Second tenant proves the same concepts compile differently.
  { tenantId:'northstar', source:'crm', entity:'deal', id:'N-1', fields:{ name:'Apollo', owner:'Garima', 'Relationship Manager':'Garima', state:'Active', pipeline_stage:'Proposal', value:90000 } },
  { tenantId:'northstar', source:'crm', entity:'deal', id:'N-2', fields:{ name:'Nova', owner:'Garima', 'Relationship Manager':'Garima', state:'Active', pipeline_stage:'Rejected', value:40000 } },
  { tenantId:'northstar', source:'crm', entity:'deal', id:'N-3', fields:{ name:'Zenith', owner:'Rahul', 'Relationship Manager':'Rahul', state:'Open', pipeline_stage:'Discovery', value:76000 } }
];

export const aliases = [
  { tenantId:'acme-law', type:'person', canonical:'Garima', variants:['garima','Garima S.'], uncertain:['Garma'] },
  { tenantId:'acme-law', type:'person', canonical:'Meera', variants:['meera','Meera K.'], uncertain:[] },
  { tenantId:'acme-law', type:'client', canonical:'ABC Private Limited', variants:['ABC Pvt Ltd','ABC Private Ltd','ABC PVT. LTD.'], uncertain:[] },
  { tenantId:'acme-law', type:'concept', canonical:'income_tax_filing', variants:['income tax file','income tax return','ITR','IT return'], uncertain:[] }
];
