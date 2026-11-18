import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { UserEntity } from "../database/entities/user.entity";

@Injectable()
export class CurrentUserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async getCurrentUser(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true, role: true },
    });

    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
    };
  }
}
