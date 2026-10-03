/** The library page's only client-side behaviour.
 *
 * Everything else on the page is already in the HTML the Worker sent: the
 * cards, the progress outlines, the result count, the pager. The filter
 * form is a plain GET form whose controls the server reads from the query
 * string. So the sole thing left to do is submit that form when a control
 * changes: it carries no submit button, so nothing else would ever send it.
 */

const filters = document.querySelector<HTMLFormElement>("#filters");

filters?.addEventListener("change", () => filters.requestSubmit());
