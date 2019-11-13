import 'typescript'

class UserController {
  public foo () {
    return this.bar()
  }

  private bar () {}
}

export default UserController
