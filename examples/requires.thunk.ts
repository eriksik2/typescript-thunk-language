import { use, provide, type Thunk } from "@thunk/runtime";
import { succeed, defer, runEffect, machine, execute, __ascribeThunkYield, __oracleRun, __makeSymbol } from "@thunk/runtime/internal";
import type { ThunkReturnType } from "@thunk/types";

declare const __brand_Config: unique symbol;
const Config = __makeSymbol<{
  environment: string;
}>("Config") as unknown as ((value: {
  environment: string;
}) => Config) & { readonly key: symbol; readonly __assoc: {
  environment: string;
} };
type Config = { readonly [__brand_Config]: typeof __brand_Config } & { readonly __assoc: {
  environment: string;
} } & { readonly __symbolIdentity?: typeof Config };

const ProductionConfig = Config({
  environment: "prod",
});
interface User {
  id: string
  name: string
};
declare const __brand_Database: unique symbol;
const Database = __makeSymbol<{
  name: string;

  getUser: (id: string) => Thunk<User>;
}>("Database") as unknown as ((value: {
  name: string;

  getUser: (id: string) => Thunk<User>;
}) => Database) & { readonly key: symbol; readonly __assoc: {
  name: string;

  getUser: (id: string) => Thunk<User>;
} };
type Database = { readonly [__brand_Database]: typeof __brand_Database } & { readonly __assoc: {
  name: string;

  getUser: (id: string) => Thunk<User>;
} } & { readonly __symbolIdentity?: typeof Database };

const DatabaseLive = __ascribeThunkYield(
async () => {
const config = await __oracleRun(use(Config));
return Database({
    name: config.environment,
    getUser: (id: string) => defer(() => succeed({
        id,
        name: "John Doe",
      }))
  });
},
defer(() => {
let __state = 0;
const __t0 = false ? use(Config) : undefined;
let config: ThunkReturnType<NonNullable<typeof __t0>>;
return machine(function (__resume?: any) {
while (true) {
switch (__state) {
case 0:
__state = 1;
return runEffect(use(Config));
case 1:
config = __resume as ThunkReturnType<NonNullable<typeof __t0>>;
return succeed(Database({
    name: config.environment,
    getUser: (id: string) => defer(() => succeed({
        id,
        name: "John Doe",
      }))
  }));
default:
throw new globalThis.Error("invalid thunk state");
}
}
});
})
);
const fetchUser = __ascribeThunkYield(
async () => {
const db = await __oracleRun(use(Database));
const user = await __oracleRun(db.getUser("1234"));
return db.name + " " + user.name;
},
defer(() => {
let __state = 0;
const __t0 = false ? use(Database) : undefined;
let db: ThunkReturnType<NonNullable<typeof __t0>>;
const __t1 = false ? db.getUser("1234") : undefined;
let user: ThunkReturnType<NonNullable<typeof __t1>>;
return machine(function (__resume?: any) {
while (true) {
switch (__state) {
case 0:
__state = 1;
return runEffect(use(Database));
case 1:
db = __resume as ThunkReturnType<NonNullable<typeof __t0>>;
__state = 2;
return runEffect(db.getUser("1234"));
case 2:
user = __resume as ThunkReturnType<NonNullable<typeof __t1>>;
return succeed(db.name + " " + user.name);
default:
throw new globalThis.Error("invalid thunk state");
}
}
});
})
);
const program = __ascribeThunkYield(
async () => {
const db = await __oracleRun(DatabaseLive);
return await __oracleRun(provide(
    fetchUser,
    db,
  ));
},
defer(() => {
let __state = 0;
const __t0 = false ? DatabaseLive : undefined;
let db: ThunkReturnType<NonNullable<typeof __t0>>;
const __t1 = false ? provide(
    fetchUser,
    db,
  ) : undefined;
return machine(function (__resume?: any) {
while (true) {
switch (__state) {
case 0:
__state = 1;
return runEffect(DatabaseLive);
case 1:
db = __resume as ThunkReturnType<NonNullable<typeof __t0>>;
__state = 2;
return runEffect(provide(
    fetchUser,
    db,
  ));
case 2:
return succeed(__resume as ThunkReturnType<NonNullable<typeof __t1>>);
default:
throw new globalThis.Error("invalid thunk state");
}
}
});
})
);
const result = execute(provide(program, ProductionConfig));
console.log(result);
