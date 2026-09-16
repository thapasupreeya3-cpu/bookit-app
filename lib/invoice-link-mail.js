'use strict';

// Old queued messages can contain receiving-account instructions and PDFs.
// Refresh only invoice demands immediately before delivery, retaining their
// original recipient, event key and immutable invoiced financial details.
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

module.exports=function invoiceLinkMail(c){
  return async function prepare(row,args){
    const meta=args[8]||{};
    if(meta.withdrawal_notice||meta.payment_receipt)return args;
    const invoiceDemand=String(row.event_key||'').startsWith('invoice:');
    if(!invoiceDemand&&!meta.payment_reminder)return args;
    const no=invoiceDemand?row.event_key.slice('invoice:'.length):meta.invoice_no;
    if(typeof no!=='string'||!no||no.length>150||/[\r\n]/.test(no))throw Error('Invoice delivery is waiting for a valid invoice number.');
    const source=await c.invoiceFor(no);
    if(!source||source.invoice_no!==no||source.withdrawn||!Array.isArray(source.lines)||!Array.isArray(source.bill_to)||!Number.isFinite(source.total))throw Error('Invoice delivery is waiting for its original invoice snapshot.');
    // Freeze the refreshed transport payload after the first preparation. A
    // retry must use the same bytes with its existing provider idempotency key,
    // even if the balance or payer profile changed after an ambiguous send.
    if(meta.invoice_link_mail_policy==='link-only-v1')return args;
    const link=await c.paymentPageURL(no);
    let parsed;try{parsed=new URL(link);}catch{}
    if(typeof link!=='string'||!parsed||parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password)throw Error('Invoice delivery is waiting for its secure invoice link.');
    const next=[...args],label=escapeHtml(no),previouslyAttempted=Number(row.attempts||0)>0;
    const failed=meta.payment_failure===true||String(row.event_key||'').startsWith('payment-failed:');
    // Use the outbox recipient, never the current profile's payer address.
    next[0]=row.recipient;
    next[1]=previouslyAttempted?'Updated payment instructions — '+no:invoiceDemand?'Invoice '+no+' — The Care Web':failed?'Payment needs attention — '+no:'Invoice payment reminder — '+no;
    next[2]=previouslyAttempted?'Updated payment instructions':invoiceDemand?'Your invoice is ready':failed?'Payment not completed':'Invoice payment is due';
    next[3]=(previouslyAttempted?'<p>These are updated payment instructions for invoice <strong>'+label+'</strong>. The invoice number and charges are unchanged.</p>':'<p>Invoice <strong>'+label+'</strong> is available through your secure invoice link.</p>')+
      '<p>Open the link to see the current balance and pay using an available online payment method. If the completed shift still needs approval, the page explains who needs to review it before payment.</p>'+
      '<p>Please use the invoice link for payment. Any bank-transfer instructions shown on an earlier copy no longer apply.</p>';
    if(!invoiceDemand)next[3]=(failed?
      '<p>Your payment for invoice <strong>'+label+'</strong> was not completed. Your shift approval is saved. Open the invoice link to check its status and try an available payment method.</p>':
      '<p>Invoice <strong>'+label+'</strong> has an outstanding balance. Open the invoice link to check the current balance and due date, then choose an available payment method.</p>')+next[3];
    next[4]='View & pay invoice';next[5]=link;
    // A pre-update send may have reached the provider despite a lost response.
    // Its old idempotency key belongs to the old body/PDF. Give the corrected
    // instructions one stable transport revision, retaining the logical outbox
    // event and invoice identity. All subsequent retries reuse this revision.
    next[8]={...meta,event_key:row.event_key+':invoice-link-v1',invoice_link_source_event_key:row.event_key,invoice_link_mail_policy:'link-only-v1'};
    if(invoiceDemand){
      const invoice=JSON.parse(JSON.stringify(source));invoice.view_url=link;
      const pdf=await c.makeInvoicePdf(invoice);
      if(!Buffer.isBuffer(pdf)||pdf.length<5||pdf.subarray(0,4).toString()!=='%PDF')throw Error('Invoice delivery is waiting for its updated PDF.');
      next[7]=[{filename:no+'.pdf',mime:'application/pdf',buffer:pdf}];
    }else next[7]=[];
    return next;
  };
};
