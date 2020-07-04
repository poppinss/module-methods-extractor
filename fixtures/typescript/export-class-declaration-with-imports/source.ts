import 'typescript'

export default class UserController {
	public foo() {
		return this.bar()
	}

	private bar() {}
}
