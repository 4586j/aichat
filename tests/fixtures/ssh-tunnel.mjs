import { createServer } from 'node:net';

const servers=[];
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]!=='-L')continue;
  const [,port]=process.argv[++i].split(':');
  const server=createServer(socket=>socket.end());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(port),'127.0.0.1',resolve);});
  servers.push(server);
}
async function close(){await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));process.exit(0);}
process.on('SIGINT',close);
process.on('SIGTERM',close);
