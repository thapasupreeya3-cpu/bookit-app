"use strict";
function page(db,conversationId,params) {
  const rawLimit=params.get('limit'),rawBefore=params.get('before'),rawAfter=params.get('after');
  const limit=rawLimit===null?100:Number(rawLimit),before=rawBefore===null?null:Number(rawBefore),after=rawAfter===null?null:Number(rawAfter);
  if(!Number.isSafeInteger(limit)||limit<1||limit>500||(before!==null&&(!Number.isSafeInteger(before)||before<1))||(after!==null&&(!Number.isSafeInteger(after)||after<1))||(before!==null&&after!==null))throw Error('Use a page size from 1 to 500 and one positive message cursor.');
  const forward=after!==null,cursor=forward?after:before;
  const rows=db.prepare(`SELECT id,sender_id,body,created,doc_kind,doc_id,doc_name FROM messages WHERE convo_id=? ${cursor===null?'':forward?'AND id > ?':'AND id < ?'} ORDER BY id ${forward?'ASC':'DESC'} LIMIT ?`).all(...(cursor===null?[conversationId,limit+1]:[conversationId,cursor,limit+1]));
  const extra=rows.length>limit;if(extra)rows.pop();if(!forward)rows.reverse();
  return {messages:rows,has_more:!forward&&extra,older_cursor:!forward&&extra&&rows.length?rows[0].id:null,has_newer:forward&&extra,newer_cursor:forward&&rows.length?rows[rows.length-1].id:null};
}
module.exports={page};
