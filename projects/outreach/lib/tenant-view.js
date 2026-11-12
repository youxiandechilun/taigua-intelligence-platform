/**
 * Existing collections retain their array interface while writes stay within
 * the current merchant. This also covers legacy assignment and index writes.
 * @template {{mid?:string}} T
 * @param {T[]} source
 * @param {string} mid
 * @returns {T[]}
 */
function scopedArray(source, mid) {
  const visible = source.filter((row) => String(row.mid) === mid);
  const own = (row) => {
    row.mid = mid;
    return row;
  };
  return new Proxy(visible, {
    get(target, property, receiver) {
      if (property === 'push') return (...rows) => {
        const added = rows.map(own);
        source.push(...added);
        return target.push(...added);
      };
      if (property === 'unshift') return (...rows) => {
        const added = rows.map(own);
        source.unshift(...added);
        return target.unshift(...added);
      };
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (/^\d+$/.test(String(property))) {
        const index = Number(property);
        const sourceIndex = source.indexOf(target[index]);
        if (sourceIndex < 0) source.push(own(value));
        else source[sourceIndex] = own(value);
      }
      return Reflect.set(target, property, value, receiver);
    },
  });
}

/**
 * @template {object} T
 * @param {T} database
 * @param {string} mid
 * @param {string[]} collections
 * @returns {T}
 */
export function tenantView(database, mid, collections) {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (collections.includes(String(property))) {
        return scopedArray(Reflect.get(target, property, receiver) ?? [], mid);
      }
      if (property === 'settings') return target.tenantSettings[mid];
      if (property === 'kb') return target.tenantKb[mid];
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (collections.includes(String(property))) {
        const remaining = target[property].filter((row) => String(row.mid) !== mid);
        target[property] = remaining.concat(value.map((row) => ({ ...row, mid })));
        return true;
      }
      if (property === 'settings') { target.tenantSettings[mid] = value; return true; }
      if (property === 'kb') { target.tenantKb[mid] = value; return true; }
      return Reflect.set(target, property, value, receiver);
    },
  });
}
