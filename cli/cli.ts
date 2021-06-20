import { PackageRegistration } from './services/packageRegistration';
import dotenv from 'dotenv';

const Main = async function() { 
    dotenv.config();
    let packageService = new PackageRegistration();
    await packageService.init();
    await packageService.add({
        arg: {
            name: process.argv[2]
        }
    });
}
Main();