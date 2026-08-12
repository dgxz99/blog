import type { CollectionEntry } from "astro:content";

/** 确保每篇文章的公开短 ID 在整个内容集合中唯一 */
export function validatePostIds(posts: CollectionEntry<"posts">[]) {
  const owners = new Map<string, string>();

  for (const post of posts) {
    const existing = owners.get(post.data.id);
    if (existing) {
      throw new Error(
        `文章短 ID 重复：${post.data.id} 同时用于 ${existing} 和 ${post.id}`
      );
    }
    owners.set(post.data.id, post.id);
  }
}
