export default async function (arg) {
  console.log(`${arg.package} is running with the following arguments:`);
  console.log(JSON.stringify(arg));
  // setInterval(() => {
  //   console.log(JSON.stringify(arg));
  // }, 5000);
}