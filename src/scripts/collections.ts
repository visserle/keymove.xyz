import { flushAccountPreferences } from "../lib/account-preferences";
import { writeBoolSetting } from "../lib/storage";

const browser = document.querySelector<HTMLElement>(".collection-browser");

if (browser) {
	const toggles =
		browser.querySelectorAll<HTMLInputElement>("[data-hide-solved]");
	const selectedCollection = (): string | undefined =>
		browser.querySelector<HTMLInputElement>(".collection-selector:checked")
			?.value;
	const navigate = (collection: string | undefined): void => {
		if (!collection) return;
		const params = new URLSearchParams({ collection });
		window.location.assign(`/collections?${params}`);
	};

	browser
		.querySelectorAll<HTMLInputElement>(
			'.collection-selector[name="collection"]',
		)
		.forEach((input) => {
			input.addEventListener("change", () => {
				if (input.checked) navigate(input.value);
			});
		});
	toggles.forEach((input) => {
		input.addEventListener("change", () => {
			const previous = !input.checked;
			toggles.forEach((other) => {
				other.checked = input.checked;
				other.disabled = true;
			});
			writeBoolSetting("hideSolved", input.checked);
			void flushAccountPreferences().then((saved) => {
				if (saved) {
					navigate(selectedCollection());
					return;
				}
				toggles.forEach((other) => {
					other.checked = previous;
					other.disabled = false;
				});
				writeBoolSetting("hideSolved", previous);
			});
		});
	});
}
