import { publicationFixture } from './publication';
// SQL-only fixture: stage 1 intentionally provides no revision/derivation API.
export async function revisionFixture() {
  const f = await publicationFixture();
  try {
    const other = await f.generate();
    const c = f.c.client;
    const sharedId = f.ids[0]!;
    c.prepare(
      'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
    ).run(other.setId, sharedId);
    const parentId = f.ids[1]!;
    const derived = c
      .prepare(
        `insert into question_versions(question_id,version_no,body,choices_json,answer_ids_json,explanation,quote,quote_verified,reviewed_by,reviewed_at,generation_run_id,derived_from_version_id,created_at)
      select question_id,2,body,choices_json,answer_ids_json,explanation,quote,quote_verified,null,null,null,id,created_at from question_versions where id=? returning id`,
      )
      .get(parentId) as { id: number };
    c.prepare(
      'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
    ).run(other.setId, derived.id);
    return {
      ...f,
      targetId: other.setId,
      sharedId,
      parentId,
      derivedId: derived.id,
    };
  } catch (error) {
    f.close();
    throw error;
  }
}
