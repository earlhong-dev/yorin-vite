// Edit an existing invitation: designed ones open the editor, uploaded ones open the upload screen
// (rename, recategorize, replace the file). The invitation must belong to this event AND this user.

import { describeDbError, getEvent, getInvitation, listCategories } from '../services/db.js';
import { h, toast } from '../ui/dom.js';
import { appPage, backLink, errorState } from '../ui/shell.js';
import { mountEditor } from './editor.js';
import { mountUpload } from './upload.js';

export default async function invitationEdit({ params, user, navigate }) {
  try {
    const [event, invitation] = await Promise.all([getEvent(user.uid, params.eventId), getInvitation(user.uid, params.invitationId)]);
    if (!event || !invitation || invitation.eventId !== event.id) {
      toast('That invitation wasn’t found.', 'error');
      navigate(event ? `/events/${event.id}` : '/dashboard', { replace: true });
      return { el: h('div') };
    }
    const categories = await listCategories(user.uid, event.id);
    const args = { user, event, categories, invitation, navigate };
    return invitation.creationType === 'created' ? mountEditor(args) : mountUpload(args);
  } catch (error) {
    console.error(error);
    return { el: appPage(user, backLink('#/dashboard', 'My Events'), errorState(describeDbError(error), () => location.reload())) };
  }
}
