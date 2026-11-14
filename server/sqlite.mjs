import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(filename=':memory:'){
  if(filename!==':memory:'){mkdirSync(dirname(filename),{recursive:true,mode:0o700});}
  const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if(filename!==':memory:')chmodSync(filename,0o600);
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  sqlite.exec('BEGIN IMMEDIATE');
  try{
    if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('0000_booking')){
      sqlite.exec(readFileSync(new URL('../drizzle/0000_booking.sql',import.meta.url),'utf8'));
      sqlite.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('0000_booking');
    }
    sqlite.exec('COMMIT');
  }catch(error){sqlite.exec('ROLLBACK');throw error;}
  return {first:async(sql,...values)=>sqlite.prepare(sql).get(...values)||null,all:async(sql,...values)=>sqlite.prepare(sql).all(...values),run:async(sql,...values)=>sqlite.prepare(sql).run(...values),close:()=>sqlite.close()};
}
