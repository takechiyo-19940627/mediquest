import { publicationFixture } from './publication';
import {
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
export async function publishedSourceFixture() {
  const f = await publicationFixture();
  replaceItems(f.c, f.run.setId, {
    expectedRevision: 0,
    versionIds: [f.ids[1]!, f.ids[0]!],
  });
  const d = f.detail();
  publishSet(f.c, f.run.setId, {
    expectedRevision: d.revision,
    publishFingerprint: d.publishFingerprint,
    confirmed: true,
  });
  return f;
}
