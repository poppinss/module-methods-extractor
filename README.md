# Module methods exporter
> Returns a list of method names and line number for a Javascript or Typescript module. 

[![circleci-image]][circleci-url] [![npm-image]][npm-url] ![][typescript-image] [![license-image]][license-url]

This module is used by the AdonisJs VsCode extension to show an autocomplete list of controller methods, event listeners and so on.

> The module is tailored for AdonisJs only, which helps in optimizing the way we scan the source code AST.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of contents

- [Usage](#usage)
- [Design & Limitations](#design--limitations)
  - [Features supported](#features-supported)
  - [Limitations](#limitations)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Usage
Install the package from npm registry as follows:

```ts
import { Extractor } from '@poppinss/Extractor'

const extractor = new Extractor()

const response = extractor.extract(`
export default class UserController {
  public async index () {
  }

  public async store () {
  }
}
`)

assert.deepEqual(response, {
  kind: 'class',
  methods: [
    {
      name: 'index',
      lineno: 2
    },
    {
      name: 'store',
      lineno: 5
    },    
  ]
})
```

## Design & Limitations

The module is written to work with AdonisJs, where modules are not imported explicitly but their filenames are passed as a reference. For example:

```ts
Route.get('users', 'UsersController.index')
```

In the above example, The `UsersController` is an actual module that has a `default export` on the `UserController` class. AdonisJs behind the scenes will use its IoC container to lazy load this class and invoke the defined method.

### Features supported

- CommonJs `module.exports` and `exports` are supported.
- ESM `export default` is supported.
- Handle assignment references like `module.exports = exports = UserController`.
- Handle inline class declarations like `export default UserController {}`.
- Returns `lineno` for all methods.

### Limitations
- Named exports are not allowed, since they are also forbidden by the IoC container automatic bindings.
- The export reference must be located as a top level property. For example:
    ```ts
    const someObject = {
      prop: class UserController {}
    }

    export default someObject.prop
    ```

    The above expression is not something we advocate in the AdonisJs eco-system and also it is not a great pattern to use either.
- Only 3 levels deep assignments are supported.
    ```ts
    // works
    module.exports = exports = UserController

    // works
    module.exports = exports = someFunc = UserController

    // does not work
    module.exports = exports = someFunc = someOtherFunc = UserController
    ```

[circleci-image]: https://img.shields.io/circleci/project/github/poppinss/module-methods-extractor/master.svg?style=for-the-badge&logo=circleci
[circleci-url]: https://circleci.com/gh/poppinss/module-methods-extractor "circleci"

[npm-image]: https://img.shields.io/npm/v/@poppinss/module-methods-extractor.svg?style=for-the-badge&logo=npm
[npm-url]: https://npmjs.org/package/@poppinss/module-methods-extractor "npm"
[typescript-image]: https://img.shields.io/badge/Typescript-294E80.svg?style=for-the-badge&logo=typescript

[license-url]: LICENSE.md
[license-image]: https://img.shields.io/github/license/poppinss/module-methods-extractor?style=for-the-badge
