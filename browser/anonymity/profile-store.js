/**
 * Profile store — persistent profile management on disk.
 * Profiles stored as JSON in app userData directory.
 */

const fs = require('fs');
const path = require('path');

class ProfileStore {
  constructor(basePath) {
    this.dir = path.join(basePath, 'profiles');
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  _profilePath(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid profile id');
    return path.join(this.dir, `${id}.json`);
  }

  save(profile) {
    fs.writeFileSync(this._profilePath(profile.id), JSON.stringify(profile, null, 2));
    return profile;
  }

  get(id) {
    const p = this._profilePath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  getActiveId() {
    const p = path.join(this.dir, 'active.json');
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return data.activeId || null;
    } catch {
      return null;
    }
  }

  setActiveId(id) {
    fs.writeFileSync(path.join(this.dir, 'active.json'), JSON.stringify({ activeId: id }));
  }


}

module.exports = { ProfileStore };
