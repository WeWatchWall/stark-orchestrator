export default async function (arg) {
  setInterval(() => {
    console.log(JSON.stringify(arg));
  }, 5000);
}