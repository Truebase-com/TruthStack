function TruthFactory(name, parents, fields, meta) {
	const generator = function() {
		if (new.target) {
			if (meta.abstract)
				throw new Error("Cannot create an instance of a abstract type.");
			// Create a new Object
			return;
		}
	};

	Object.assign(generator, "name", { value: name });
	return generator;
}

TruthFactory.union = function union() {};

TruthFactory.resolve = function resolve() {};

const User = TruthFactory("User", [], {
	id: String,
	username: String,
	age: Number
});

const Item = TruthFactory(
	"Item",
	[],
	{
		/**... */
	},
	{
		abstract: true
	}
);

const Product = TruthFactory("Product", ["Item", "WithPrice"], {
	name: String,
	owner: "User",
	sth: TruthFactory.union("Item", "User")
});

TruthFactory.resolve();
