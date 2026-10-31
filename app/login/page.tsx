import { all } from "@/lib/db";
import LoginClient, { Person } from "@/components/LoginClient";

export default async function Login() {
  const people = await all<Person>(
    `SELECT u.id, u.name, u.access_role role, u.op_role op,
      (SELECT group_concat(p.name, ', ') FROM user_properties up JOIN properties p ON p.id=up.property_id WHERE up.user_id=u.id) props,
      (SELECT c.name FROM user_properties up JOIN properties p ON p.id=up.property_id JOIN clusters cl ON cl.id=p.cluster_id JOIN cities c ON c.id=cl.city_id WHERE up.user_id=u.id LIMIT 1) city,
      (SELECT cl.name FROM user_properties up JOIN properties p ON p.id=up.property_id JOIN clusters cl ON cl.id=p.cluster_id WHERE up.user_id=u.id LIMIT 1) cluster
     FROM users u ORDER BY u.id`);
  return <LoginClient people={people} />;
}
