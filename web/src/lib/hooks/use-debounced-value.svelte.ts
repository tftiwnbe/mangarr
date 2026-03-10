export class DebouncedValue<T> {
	value = $state<T>();

	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(source: () => T, delayMs = 300) {
		this.value = source();

		$effect(() => {
			const nextValue = source();
			if (this.#timer) {
				clearTimeout(this.#timer);
			}

			this.#timer = setTimeout(() => {
				this.value = nextValue;
				this.#timer = null;
			}, delayMs);

			return () => {
				if (this.#timer) {
					clearTimeout(this.#timer);
					this.#timer = null;
				}
			};
		});
	}
}
